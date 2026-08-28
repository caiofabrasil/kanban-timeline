/*
 * Kanban Timeline & Timeblocking Plugin for Obsidian
 * Cronograma Horizontal (Jira-style Gantt) + Timeblocking Vertical Diário
 * Sincronizado com o Obsidian Kanban via metadados no arquivo .md
 *
 * Metadados suportados:
 *   @{DD-MM-YYYY}                  — data única
 *   @{DD-MM-YYYY..DD-MM-YYYY}      — intervalo de dias (Gantt)
 *   ⏰ HH:mm-HH:mm                 — bloco de horário diário (Timeblocking)
 */

'use strict';

var obsidian = require('obsidian');

// ================================================================
// CONSTANTS & PALETTES
// ================================================================

const VIEW_TYPE = 'kanban-timeline-view';

const DEFAULT_PALETTE = [
    '#6366f1', '#ec4899', '#f97316', '#3b82f6', '#10b981', 
    '#8b5cf6', '#06b6d4', '#eab308', '#14b8a6', '#f43f5e',
    '#84cc16', '#a855f7', '#0284c7', '#d97706', '#059669'
];

function hashStringToColor(str) {
    if (!str) return '#6366f1';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % DEFAULT_PALETTE.length;
    return DEFAULT_PALETTE[index];
}

const PRIORITY_COLORS = {
    'urgent': '#ef4444',
    'high':   '#f97316',
    'mid':    '#eab308',
    'low':    '#22c55e',
};

const PRIORITY_TAGS  = new Set(['low', 'mid', 'high', 'urgent']);
const DEFAULT_GANTT_DAYS = 14;

// ================================================================
// UTILS
// ================================================================

function parseDate(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.trim().split('-');
    if (parts.length !== 3) return null;
    const [dd, mm, yyyy] = parts.map(Number);
    if (!dd || !mm || !yyyy) return null;
    const d = new Date(yyyy, mm - 1, dd);
    if (isNaN(d.getTime())) return null;
    return d;
}

function formatDate(date) {
    if (!date) return '';
    const dd   = String(date.getDate()).padStart(2, '0');
    const mm   = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

function sameDay(a, b) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth()    === b.getMonth()    &&
           a.getDate()     === b.getDate();
}

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function getHabitDateKey(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getCardTagColor(tags, customProjects = []) {
    if (!tags || tags.length === 0) return null;
    for (const tag of tags) {
        const key = tag.replace(/^#/, '').toLowerCase().trim();
        if (PRIORITY_TAGS.has(key)) continue; // Priority tags are exclusively for the bottom bar
        
        // 1. Check custom user-configured projects by tag or name
        if (Array.isArray(customProjects)) {
            for (const proj of customProjects) {
                const pTag = (proj.tag || '').replace(/^#/, '').toLowerCase().trim();
                const pName = (proj.name || '').toLowerCase().trim();
                if (pTag && (key === pTag || key.includes(pTag) || pTag.includes(key))) {
                    return proj.color || '#6366f1';
                }
                if (pName && (key === pName || key.includes(pName) || pName.includes(key))) {
                    return proj.color || '#6366f1';
                }
            }
        }

        // 2. Generate a consistent beautiful color from hash
        return hashStringToColor(key);
    }
    return null;
}

function getColumnColor(column, customColors = {}, customProjects = []) {
    if (!column) return '#6366f1';
    if (customColors[column]) return customColors[column];
    const colKey = column.toLowerCase().trim();
    for (const [colName, color] of Object.entries(customColors)) {
        if (colName.toLowerCase().trim() === colKey) return color;
    }

    // Check if column belongs to or matches any configured project
    if (Array.isArray(customProjects)) {
        for (const proj of customProjects) {
            if (Array.isArray(proj.columns)) {
                for (const c of proj.columns) {
                    if ((c || '').toLowerCase().trim() === colKey) {
                        return proj.color || '#6366f1';
                    }
                }
            }
            const pName = (proj.name || '').toLowerCase().trim();
            const pTag = (proj.tag || '').replace(/^#/, '').toLowerCase().trim();
            if (pName && (colKey.includes(pName) || pName.includes(colKey))) {
                return proj.color || '#6366f1';
            }
            if (pTag && (colKey.includes(pTag) || pTag.includes(colKey))) {
                return proj.color || '#6366f1';
            }
        }
    }

    return hashStringToColor(colKey);
}

function getProjectColor(tags, column, customColors = {}, customProjects = []) {
    const tagCol = getCardTagColor(tags, customProjects);
    if (tagCol) return tagCol;
    return getColumnColor(column, customColors, customProjects);
}

function getProjectForCard(card, customProjects = []) {
    if (!card || !Array.isArray(customProjects) || customProjects.length === 0) return null;
    const tags = card.tags || [];
    const col = (card.column || '').toLowerCase().trim();

    // 1. Check custom user-configured projects by tag or name
    for (const tag of tags) {
        const key = tag.replace(/^#/, '').toLowerCase().trim();
        if (PRIORITY_TAGS.has(key)) continue;
        for (const proj of customProjects) {
            const pTag = (proj.tag || '').replace(/^#/, '').toLowerCase().trim();
            const pName = (proj.name || '').toLowerCase().trim();
            if (pTag && (key === pTag || key.includes(pTag) || pTag.includes(key))) {
                return proj;
            }
            if (pName && (key === pName || key.includes(pName) || pName.includes(key))) {
                return proj;
            }
        }
    }

    // 2. Check if column belongs to or matches any configured project
    if (col) {
        for (const proj of customProjects) {
            if (Array.isArray(proj.columns)) {
                for (const c of proj.columns) {
                    if ((c || '').toLowerCase().trim() === col) {
                        return proj;
                    }
                }
            }
            const pName = (proj.name || '').toLowerCase().trim();
            const pTag = (proj.tag || '').replace(/^#/, '').toLowerCase().trim();
            if (pName && (col.includes(pName) || pName.includes(col))) {
                return proj;
            }
            if (pTag && (col.includes(pTag) || pTag.includes(col))) {
                return proj;
            }
        }
    }

    return null;
}

function getPriorityColor(tags) {
    if (!tags) return null;
    for (const tag of tags) {
        const key = tag.replace(/^#/, '').toLowerCase();
        if (PRIORITY_COLORS[key]) return PRIORITY_COLORS[key];
    }
    return null;
}

function isIgnoredColumn(columnName) {
    if (!columnName || typeof columnName !== 'string') return false;
    const col = columnName.trim().toLowerCase();
    return col === 'done' || 
           col === 'concluido' || 
           col === 'concluído' || 
           col === 'arquivado' || 
           col === 'archive' || 
           col === 'settings';
}

function isDoneColumn(columnName) {
    if (!columnName || typeof columnName !== 'string') return false;
    const col = columnName.trim().toLowerCase();
    return col === 'done' || 
           col === 'concluido' || 
           col === 'concluído';
}

function getDoneColumnName(columns) {
    if (!columns || !columns.length) return 'Done';
    const found = columns.find(c => isDoneColumn(c));
    return found || 'Done';
}

function parseTimeEstimate(str) {
    if (!str || typeof str !== 'string') return { minutes: 0, text: '', clean: str };
    
    // Support formats: ~2h, ~30m, ~1.5h, ~2h30m, (2h), (45m), [2h], est: 2h
    const estRegex = /(?:^|\s)(?:~|est:|\(|\[)(\d+(?:\.\d+)?(?:h|hrs?|m|mins?)?(?:\d+m)?)(?:\)|\])?/i;
    const match = str.match(estRegex);
    if (!match) return { minutes: 0, text: '', clean: str };

    const rawVal = match[1].toLowerCase().trim();
    let totalMin = 0;

    // Compound e.g. 2h30m
    const compoundMatch = rawVal.match(/^(\d+(?:\.\d+)?)h(?:(\d+)m)?$/);
    if (compoundMatch) {
        const h = parseFloat(compoundMatch[1]);
        const m = compoundMatch[2] ? parseInt(compoundMatch[2], 10) : 0;
        totalMin = Math.round(h * 60 + m);
    } else if (/^\d+m(?:in)?$/.test(rawVal)) {
        // e.g. 30m, 45min
        totalMin = parseInt(rawVal, 10);
    } else if (/^\d+(?:\.\d+)?h(?:rs?)?$/.test(rawVal)) {
        // e.g. 2h, 1.5h
        totalMin = Math.round(parseFloat(rawVal) * 60);
    } else if (/^\d+$/.test(rawVal)) {
        const num = parseFloat(rawVal);
        totalMin = num <= 12 ? Math.round(num * 60) : Math.round(num);
    }

    if (totalMin <= 0) return { minutes: 0, text: '', clean: str };

    const clean = str.replace(match[0], ' ').replace(/\s{2,}/g, ' ').trim();
    const formattedText = formatMinutesToHours(totalMin);

    return {
        minutes: totalMin,
        text: formattedText,
        clean
    };
}

function formatMinutesToHours(min) {
    if (!min || min <= 0) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) {
        const dec = Math.round((m / 60) * 10) / 10;
        return dec > 0 ? `${(h + dec)}h` : `${h}h`;
    }
    return `${m}m`;
}

function formatCurrency(amount, currency = 'R$') {
    const formattedNum = Number(amount || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return `${currency} ${formattedNum}`;
}

function renderFormattedTextWithLinks(parentEl, text, app, sourcePath) {
    if (!text) return;
    const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let lastIdx = 0;
    let match;
    while ((match = linkRegex.exec(text)) !== null) {
        const preText = text.slice(lastIdx, match.index);
        if (preText) parentEl.createSpan().setText(preText);
        const linkTarget = match[1];
        const linkDisplay = match[2] || linkTarget;
        const linkEl = parentEl.createEl('a', {
            cls: 'internal-link',
            text: linkDisplay,
            attr: { 'data-href': linkTarget }
        });
        linkEl.onclick = (e) => {
            e.stopPropagation();
            if (app && app.workspace) {
                app.workspace.openLinkText(linkTarget, sourcePath || '', false);
            }
        };
        lastIdx = match.index + match[0].length;
    }
    const postText = text.slice(lastIdx);
    if (postText) parentEl.createSpan().setText(postText);
}

function renderCardImage(parentEl, imgRef, app) {
    if (!imgRef) return;
    const cleanRef = imgRef.replace(/^!\[\[/, '').replace(/\]\]$/, '').trim();
    const imgWrap = parentEl.createDiv('kt-card-image-wrap');
    const img = imgWrap.createEl('img', { cls: 'kt-card-img' });
    
    let file = null;
    try {
        if (app && app.metadataCache) {
            file = app.metadataCache.getFirstLinkpathDest(cleanRef, '');
        }
    } catch (e) {}

    if (file && app && app.vault) {
        img.src = app.vault.getResourcePath(file);
    } else if (cleanRef.startsWith('http://') || cleanRef.startsWith('https://')) {
        img.src = cleanRef;
    } else {
        img.alt = cleanRef;
        img.src = cleanRef;
    }

    img.onclick = (e) => {
        e.stopPropagation();
        if (file && app && app.workspace) {
            app.workspace.openLinkText(file.path, '', false);
        }
    };
}

function timeToMinutes(str) {
    if (!str) return 0;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + (m || 0);
}

function minutesToTime(mins) {
    const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
    const h = String(Math.floor(clamped / 60)).padStart(2, '0');
    const m = String(clamped % 60).padStart(2, '0');
    return `${h}:${m}`;
}

function getTimeForDay(card, date) {
    if (!card || !date) return null;
    if (card.isRemoteCalendarEvent) {
        if (sameDay(card.startDate, date)) {
            return { timeStart: card.timeStart, timeEnd: card.timeEnd };
        }
        return null;
    }
    const dStr = formatDate(date);
    if (card.dailyTimes && card.dailyTimes[dStr]) {
        return card.dailyTimes[dStr];
    }
    if (card.timeStart && card.timeEnd) {
        if (!card.dailyTimes || Object.keys(card.dailyTimes).length === 0) {
            if (sameDay(card.startDate, date)) {
                return { timeStart: card.timeStart, timeEnd: card.timeEnd };
            }
        }
    }
    return null;
}

function getCardTimeblockStatus(card) {
    if (!card || !card.startDate) return { totalDays: 0, timeblockedDays: 0, isFullyTimeblocked: false };

    const start = startOfDay(card.startDate);
    const end   = startOfDay(card.endDate || card.startDate);
    
    let totalDays = 0;
    let timeblockedDays = 0;

    const cur = new Date(start);
    while (cur <= end) {
        totalDays++;
        const dt = getTimeForDay(card, cur);
        if (dt && dt.timeStart && dt.timeEnd) {
            timeblockedDays++;
        }
        cur.setDate(cur.getDate() + 1);
    }

    const isFullyTimeblocked = totalDays > 0 && timeblockedDays === totalDays;
    return { totalDays, timeblockedDays, isFullyTimeblocked };
}

// ================================================================
// KANBAN PARSER
// ================================================================

class KanbanParser {
    /** Parse an Obsidian Kanban .md file and return cards and columns */
    parse(content, customColors = {}, customProjects = []) {
        const cards   = [];
        const columns = [];
        const colColors = {};
        const lines   = content.split('\n');
        let currentColumn = 'Backlog';
        let lastCard = null;

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmed = raw.trim();

            // Column heading: ## Column Name (support <!-- color: #hex -->)
            if (/^##\s+/.test(trimmed)) {
                let colRaw = trimmed.replace(/^##\s+/, '').trim();
                const colColorMatch = colRaw.match(/<!--\s*(?:color:?|#)\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*-->/i);
                if (colColorMatch) {
                    colColors[colRaw.replace(/<!--[\s\S]*?-->/, '').trim()] = colColorMatch[1];
                    colRaw = colRaw.replace(/<!--[\s\S]*?-->/, '').trim();
                }
                currentColumn = colRaw;
                if (!columns.includes(currentColumn)) {
                    columns.push(currentColumn);
                }
                lastCard = null;
                continue;
            }

            // Standalone indented tag line under a card (e.g. #Projeto, #Dev, #Mid)
            if (/^#[\w-]+(?:\s+#[\w-]+)*$/.test(trimmed) && lastCard) {
                const subTags = trimmed.match(/#[\w-]+/g) || [];
                subTags.forEach(t => {
                    if (!lastCard.tags.includes(t)) lastCard.tags.push(t);
                });
                lastCard.tagColor = getCardTagColor(lastCard.tags, customProjects);
                lastCard.priorityColor = getPriorityColor(lastCard.tags);
                lastCard.projectColor = getProjectColor(lastCard.tags, lastCard.column, { ...customColors, ...colColors }, customProjects);
                continue;
            }

            // Card line: - [ ] or - [x]
            const m = trimmed.match(/^-\s+\[([ x])\]\s+(.+)/);
            if (!m) {
                // If not a - [ ] line, check if it is an indented child under lastCard:
                const isChild = /^\s{2,}|\t/.test(raw);
                if (isChild && lastCard) {
                    // 1. Image: ![[image.png]] or ![](url)
                    const imgMatch = trimmed.match(/^!\[\[([\s\S]*?)\]\]/) || trimmed.match(/^!\[(.*?)\]\((.*?)\)/);
                    if (imgMatch) {
                        if (!lastCard.images) lastCard.images = [];
                        lastCard.images.push(imgMatch[1] || imgMatch[2]);
                        continue;
                    }

                    // 2. Bullet point (starts with - or * without [ ])
                    const bulletMatch = trimmed.match(/^[-*]\s+(?!\[[ xX]\])(.+)/);
                    if (bulletMatch) {
                        if (!lastCard.bullets) lastCard.bullets = [];
                        let bText = bulletMatch[1];
                        const bTags = bText.match(/#[\w-]+/g);
                        if (bTags) {
                            bTags.forEach(t => { if (!lastCard.tags.includes(t)) lastCard.tags.push(t); });
                            bText = bText.replace(/#[\w-]+/g, '').trim();
                        }
                        lastCard.bullets.push({ text: bText });
                        continue;
                    }

                    // 3. General note line or link
                    let noteText = trimmed;
                    const subTagMatches = trimmed.match(/#[\w-]+/g);
                    if (subTagMatches) {
                        subTagMatches.forEach(t => {
                            if (!lastCard.tags.includes(t)) lastCard.tags.push(t);
                        });
                        noteText = noteText.replace(/#[\w-]+/g, '').trim();
                    }
                    if (noteText) {
                        if (!lastCard.notes) lastCard.notes = [];
                        lastCard.notes.push(noteText);
                    }
                    lastCard.tagColor = getCardTagColor(lastCard.tags, customProjects);
                    lastCard.priorityColor = getPriorityColor(lastCard.tags);
                    lastCard.projectColor = getProjectColor(lastCard.tags, lastCard.column, { ...customColors, ...colColors }, customProjects);
                }
                continue;
            }

            const isCompleted = m[1] === 'x';
            let rest = m[2];

            // Ignore nested checklist child lines from becoming top-level cards, but capture any tags and subtasks
            const isSubtask = /^\s{2,}|\t/.test(raw);
            if (isSubtask && lastCard) {
                const subCheckMatch = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)/);
                if (subCheckMatch) {
                    if (!lastCard.subtasks) lastCard.subtasks = [];
                    let stText = subCheckMatch[2];
                    const stTags = stText.match(/#[\w-]+/g);
                    if (stTags) {
                        stTags.forEach(t => { if (!lastCard.tags.includes(t)) lastCard.tags.push(t); });
                        stText = stText.replace(/#[\w-]+/g, '').trim();
                    }
                    lastCard.subtasks.push({
                        lineIndex: i,
                        completed: subCheckMatch[1].toLowerCase() === 'x',
                        text: stText
                    });
                } else if (!trimmed.startsWith('#')) {
                    if (!lastCard.notes) lastCard.notes = [];
                    lastCard.notes.push(trimmed);
                }

                const subTagMatches = trimmed.match(/#[\w-]+/g);
                if (subTagMatches) {
                    subTagMatches.forEach(t => {
                        if (!lastCard.tags.includes(t)) lastCard.tags.push(t);
                    });
                    lastCard.tagColor = getCardTagColor(lastCard.tags, customProjects);
                    lastCard.priorityColor = getPriorityColor(lastCard.tags);
                    lastCard.projectColor = getProjectColor(lastCard.tags, lastCard.column, { ...customColors, ...colColors }, customProjects);
                }
                continue;
            }

            // Date range: @{DD-MM-YYYY..DD-MM-YYYY}
            let startDate = null, endDate = null;
            const drm = rest.match(/@\{(\d{2}-\d{2}-\d{4})\.\.(\d{2}-\d{2}-\d{4})\}/);
            if (drm) {
                startDate = parseDate(drm[1]);
                endDate   = parseDate(drm[2]);
                rest = rest.replace(drm[0], '');
            }

            // Single date: @{DD-MM-YYYY}
            if (!startDate) {
                const dsm = rest.match(/@\{(\d{2}-\d{2}-\d{4})\}/);
                if (dsm) {
                    startDate = parseDate(dsm[1]);
                    endDate   = new Date(startDate);
                    rest = rest.replace(dsm[0], '');
                }
            }

            // Time block: support invisible comment <!-- tb: ... --> as well as legacy ⏰ tags
            const dailyTimes = {};
            let legacyStart = null, legacyEnd = null;

            // 1. Comment-based time block tags: <!-- tb: ... --> or <!-- ⏰ ... -->
            const commentRegex = /<!--\s*(?:tb:?|⏰)\s*([\s\S]*?)-->/g;
            let cm;
            while ((cm = commentRegex.exec(rest)) !== null) {
                const commentBody = cm[1];
                const innerDatedRegex = /(\d{2}-\d{2}-\d{4})\s*[:\s]?\s*(\d{2}:\d{2})-(\d{2}:\d{2})/g;
                let idm;
                let foundDated = false;
                while ((idm = innerDatedRegex.exec(commentBody)) !== null) {
                    dailyTimes[idm[1]] = { timeStart: idm[2], timeEnd: idm[3] };
                    foundDated = true;
                }
                if (!foundDated) {
                    const innerSimpleRegex = /(?:^|\s)(\d{2}:\d{2})-(\d{2}:\d{2})/g;
                    let ism;
                    while ((ism = innerSimpleRegex.exec(commentBody)) !== null) {
                        legacyStart = ism[1];
                        legacyEnd   = ism[2];
                    }
                }
            }
            rest = rest.replace(/<!--\s*(?:tb:?|⏰)\s*[\s\S]*?-->/g, '');

            // 2. Legacy dated time tags: ⏰ 15-08-2026 09:00-12:00
            const datedTimeRegex = /⏰\s*(\d{2}-\d{2}-\d{4})\s*[:\s]?\s*(\d{2}:\d{2})-(\d{2}:\d{2})/g;
            let dtm;
            while ((dtm = datedTimeRegex.exec(rest)) !== null) {
                dailyTimes[dtm[1]] = { timeStart: dtm[2], timeEnd: dtm[3] };
            }
            rest = rest.replace(/⏰\s*\d{2}-\d{2}-\d{4}\s*[:\s]?\s*\d{2}:\d{2}-\d{2}:\d{2}/g, '');

            // 3. Legacy simple time tags: ⏰ 09:00-12:00
            const simpleTimeRegex = /⏰\s*(\d{2}:\d{2})-(\d{2}:\d{2})/g;
            let stm;
            while ((stm = simpleTimeRegex.exec(rest)) !== null) {
                legacyStart = stm[1];
                legacyEnd   = stm[2];
            }
            rest = rest.replace(/⏰\s*\d{2}:\d{2}-\d{2}:\d{2}/g, '');

            // Fallback: If legacy time was found and startDate exists, map to startDate
            if (legacyStart && legacyEnd && startDate) {
                const sStr = formatDate(startDate);
                if (!dailyTimes[sStr]) {
                    dailyTimes[sStr] = { timeStart: legacyStart, timeEnd: legacyEnd };
                }
            }

            const firstDateKey = Object.keys(dailyTimes)[0];
            const timeStart = legacyStart || (firstDateKey ? dailyTimes[firstDateKey].timeStart : null);
            const timeEnd   = legacyEnd   || (firstDateKey ? dailyTimes[firstDateKey].timeEnd   : null);

            // Calculate workload duration directly from Timeblocking time slots (timeEnd - timeStart)
            let tbDurationMinutes = 0;
            const dKeys = Object.keys(dailyTimes);
            if (dKeys.length > 0) {
                for (const dKey of dKeys) {
                    const dt = dailyTimes[dKey];
                    if (dt.timeStart && dt.timeEnd) {
                        const dur = timeToMinutes(dt.timeEnd) - timeToMinutes(dt.timeStart);
                        if (dur > 0) tbDurationMinutes += dur;
                    }
                }
            } else if (timeStart && timeEnd) {
                const dur = timeToMinutes(timeEnd) - timeToMinutes(timeStart);
                if (dur > 0) tbDurationMinutes = dur;
            }

            // If timeblock duration exists, it is the primary source of truth for duration!
            const estInfo = parseTimeEstimate(rest);
            const estimateMinutes = tbDurationMinutes > 0 ? tbDurationMinutes : estInfo.minutes;
            const estimateText = estimateMinutes > 0 ? formatMinutesToHours(estimateMinutes) : '';
            rest = estInfo.clean;

            // Tags
            const tagMatches = rest.match(/#[\w-]+/g) || [];
            const tags = tagMatches.map(t => t);
            rest = rest.replace(/#[\w-]+/g, '').trim();

            const title = rest.trim();
            if (!title) continue;

            // Detect if this is an Event/Routine block (Pausa, Reunião, Foco, etc.)
            let isEvent = false;
            let eventType = 'task'; // 'break' | 'meeting' | 'focus' | 'custom'

            // Check comments for event type
            const rawComment = (m[2].match(/<!--\s*([\s\S]*?)-->/) || [])[1] || '';
            if (/type:(?:break|pausa|almoco|refeicao)/i.test(rawComment)) {
                isEvent = true; eventType = 'break';
            } else if (/type:(?:meeting|reuniao|call|sync)/i.test(rawComment)) {
                isEvent = true; eventType = 'meeting';
            } else if (/type:(?:focus|foco|estudo)/i.test(rawComment)) {
                isEvent = true; eventType = 'focus';
            } else if (/type:(?:custom|event|rotina)/i.test(rawComment)) {
                isEvent = true; eventType = 'custom';
            } else if (/^[☕🍽️🍵🍎⏸️]/.test(title)) {
                isEvent = true; eventType = 'break';
            } else if (/^[👥🤝💼📞🗣️]/.test(title)) {
                isEvent = true; eventType = 'meeting';
            } else if (/^[🎯🧠⚡📖]/.test(title)) {
                isEvent = true; eventType = 'focus';
            }

            const seriesMatch = rawComment.match(/series:([^\s]+)/i);
            const seriesId = seriesMatch ? seriesMatch[1] : null;

            const tagColor = isEvent ? null : getCardTagColor(tags, customProjects);
            const colColor = isEvent ? null : getColumnColor(currentColumn, { ...customColors, ...colColors }, customProjects);
            const projColor = isEvent ? null : getProjectColor(tags, currentColumn, { ...customColors, ...colColors }, customProjects);

            const card = {
                id:              `${i}-${title}`,
                title,
                column:          currentColumn,
                isCompleted,
                tags,
                subtasks:        [],
                bullets:         [],
                images:          [],
                notes:           [],
                estimateMinutes,
                estimateText,
                startDate,
                endDate,
                timeStart,
                timeEnd,
                dailyTimes,
                isEvent,
                eventType,
                seriesId,
                lineIndex:       i,
                tagColor:        tagColor,
                projectColor:    isEvent ? null : (projColor || '#6366f1'),
                priorityColor:   isEvent ? null : getPriorityColor(tags),
            };

            cards.push(card);
            lastCard = card;
        }

        return { cards, columns, columnColors: colColors };
    }

    /** Update column color in Kanban file */
    updateColumnColorInFile(content, columnName, newColor) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (/^##\s+/.test(trimmed)) {
                let name = trimmed.replace(/^##\s+/, '').replace(/<!--[\s\S]*?-->/, '').trim();
                if (name.toLowerCase() === columnName.toLowerCase()) {
                    lines[i] = `## ${name} <!-- color: ${newColor} -->`;
                    break;
                }
            }
        }
        return lines.join('\n');
    }

    /** Add a new card to a column in the Kanban file */
    addCardToColumn(content, targetColumnName, cardTitle) {
        if (!cardTitle || !cardTitle.trim()) return content;
        const lines = content.split('\n');
        const targetClean = targetColumnName.trim().toLowerCase().replace(/[\s-_]+/g, '');
        let targetHeadingIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (/^##\s+/.test(trimmed)) {
                const name = trimmed.replace(/^##\s+/, '').replace(/<!--[\s\S]*?-->/, '').trim();
                const nameClean = name.toLowerCase().replace(/[\s-_]+/g, '');
                if (nameClean === targetClean || name.toLowerCase() === targetColumnName.toLowerCase()) {
                    targetHeadingIndex = i;
                    break;
                }
            }
        }

        if (targetHeadingIndex === -1) {
            const settingsIdx = lines.findIndex(l => /^%%\s*kanban:settings/i.test(l.trim()));
            if (settingsIdx !== -1) {
                lines.splice(settingsIdx, 0, '', `## ${targetColumnName}`, '');
                targetHeadingIndex = settingsIdx + 1;
            } else {
                lines.push('', `## ${targetColumnName}`, '');
                targetHeadingIndex = lines.length - 2;
            }
        }

        // Insert the new card at the TOP of this column (right after ## Heading)
        lines.splice(targetHeadingIndex + 1, 0, `- [ ] ${cardTitle.trim()}`, '');

        return lines.join('\n');
    }

    /** Toggle subtask completion state ([ ] <-> [x]) */
    toggleSubtaskCompletion(content, subtaskLineIndex) {
        const lines = content.split('\n');
        if (subtaskLineIndex < 0 || subtaskLineIndex >= lines.length) return content;

        const line = lines[subtaskLineIndex];
        if (/-\s+\[\s*\]/.test(line)) {
            lines[subtaskLineIndex] = line.replace(/(-\s+)\[\s*\]/, '$1[x]');
        } else if (/-\s+\[[xX]\]/.test(line)) {
            lines[subtaskLineIndex] = line.replace(/(-\s+)\[[xX]\]/, '$1[ ]');
        }

        return lines.join('\n');
    }

    /** Toggle card completion state ([ ] <-> [x]) */
    toggleCardCompletion(content, cardLineIndex) {
        const lines = content.split('\n');
        if (cardLineIndex < 0 || cardLineIndex >= lines.length) return content;

        const line = lines[cardLineIndex];
        if (/^-\s+\[\s*\]/.test(line)) {
            lines[cardLineIndex] = line.replace(/^-\s+\[\s*\]/, '- [x]');
        } else if (/^-\s+\[[xX]\]/.test(line)) {
            lines[cardLineIndex] = line.replace(/^-\s+\[[xX]\]/, '- [ ]');
        }

        return lines.join('\n');
    }

    /** Delete a card block including subtasks */
    deleteCard(content, cardLineIndex) {
        const lines = content.split('\n');
        if (cardLineIndex < 0 || cardLineIndex >= lines.length) return content;

        let endIndex = cardLineIndex + 1;
        while (endIndex < lines.length) {
            const raw = lines[endIndex];
            const trimmed = raw.trim();
            if (/^-\s+\[[ x]\]/.test(raw) && !/^\s+/.test(raw)) break;
            if (/^##\s+/.test(trimmed) || /^%%\s*kanban:settings/i.test(trimmed)) break;
            endIndex++;
        }

        lines.splice(cardLineIndex, endIndex - cardLineIndex);
        return lines.join('\n');
    }

    /** Delete a column heading and all cards under it */
    deleteColumn(content, targetColumnName) {
        const lines = content.split('\n');
        const targetClean = targetColumnName.trim().toLowerCase().replace(/[\s-_]+/g, '');
        let startIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (/^##\s+/.test(trimmed)) {
                const name = trimmed.replace(/^##\s+/, '').replace(/<!--[\s\S]*?-->/, '').trim();
                const nameClean = name.toLowerCase().replace(/[\s-_]+/g, '');
                if (nameClean === targetClean || name.toLowerCase() === targetColumnName.toLowerCase()) {
                    startIndex = i;
                    break;
                }
            }
        }

        if (startIndex === -1) return content;

        // Find end index (next column heading ## or %% kanban:settings or end of file)
        let endIndex = startIndex + 1;
        while (endIndex < lines.length) {
            const trimmed = lines[endIndex].trim();
            if (/^##\s+/.test(trimmed) || /^%%\s*kanban:settings/i.test(trimmed)) {
                break;
            }
            endIndex++;
        }

        // Clean up empty lines before startIndex if any
        while (startIndex > 0 && lines[startIndex - 1].trim() === '') {
            startIndex--;
        }

        lines.splice(startIndex, endIndex - startIndex);
        return lines.join('\n');
    }

    /** Reorder columns in markdown file according to orderedColumnNames */
    reorderColumns(content, orderedColumnNames) {
        const lines = content.split('\n');
        
        // 1. Separate pre-column lines (lines before the first ## Heading)
        let firstHeadingIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (/^##\s+/.test(lines[i].trim())) {
                firstHeadingIndex = i;
                break;
            }
        }

        if (firstHeadingIndex === -1) return content; // No columns found

        const preLines = lines.slice(0, firstHeadingIndex);

        // 2. Identify the footer / settings block (%% kanban:settings ... %%)
        let settingsIndex = -1;
        for (let i = firstHeadingIndex; i < lines.length; i++) {
            if (/^%%\s*kanban:settings/i.test(lines[i].trim())) {
                settingsIndex = i;
                break;
            }
        }

        const footerLines = settingsIndex !== -1 ? lines.slice(settingsIndex) : [];
        const columnLinesSlice = settingsIndex !== -1 
            ? lines.slice(firstHeadingIndex, settingsIndex) 
            : lines.slice(firstHeadingIndex);

        // 3. Extract each column block
        const columnBlocks = []; // [{ name, cleanName, lines: [...] }]
        let currentBlock = null;

        for (let i = 0; i < columnLinesSlice.length; i++) {
            const line = columnLinesSlice[i];
            const trimmed = line.trim();

            if (/^##\s+/.test(trimmed)) {
                if (currentBlock) {
                    while (currentBlock.lines.length > 0 && currentBlock.lines[currentBlock.lines.length - 1].trim() === '') {
                        currentBlock.lines.pop();
                    }
                    columnBlocks.push(currentBlock);
                }

                const rawCol = trimmed.replace(/^##\s+/, '').replace(/<!--[\s\S]*?-->/, '').trim();
                const cleanName = rawCol.toLowerCase().replace(/[\s-_]+/g, '');
                currentBlock = {
                    name: rawCol,
                    cleanName: cleanName,
                    lines: [line]
                };
            } else {
                if (currentBlock) {
                    currentBlock.lines.push(line);
                }
            }
        }

        if (currentBlock) {
            while (currentBlock.lines.length > 0 && currentBlock.lines[currentBlock.lines.length - 1].trim() === '') {
                currentBlock.lines.pop();
            }
            columnBlocks.push(currentBlock);
        }

        // 4. Assemble columns in requested order
        const resultLines = [...preLines];
        if (resultLines.length > 0 && resultLines[resultLines.length - 1].trim() !== '') {
            resultLines.push('');
        }

        const placedBlocks = new Set();

        orderedColumnNames.forEach(colName => {
            const targetClean = colName.trim().toLowerCase().replace(/[\s-_]+/g, '');
            const blockIndex = columnBlocks.findIndex((b, idx) => !placedBlocks.has(idx) && (b.cleanName === targetClean || b.name.toLowerCase() === colName.toLowerCase()));
            if (blockIndex !== -1) {
                placedBlocks.add(blockIndex);
                resultLines.push(...columnBlocks[blockIndex].lines, '');
            }
        });

        // 5. Append any remaining blocks not in orderedColumnNames
        columnBlocks.forEach((block, idx) => {
            if (!placedBlocks.has(idx)) {
                resultLines.push(...block.lines, '');
            }
        });

        // 6. Append footer/settings lines
        if (footerLines.length > 0) {
            if (resultLines.length > 0 && resultLines[resultLines.length - 1].trim() !== '') {
                resultLines.push('');
            }
            resultLines.push(...footerLines);
        }

        return resultLines.join('\n');
    }

    /** Move a card block (including subtasks/tags) to another column or position */
    moveCardToColumn(content, cardLineIndex, targetColumnName, targetLineIndex = -1) {
        const lines = content.split('\n');
        if (cardLineIndex < 0 || cardLineIndex >= lines.length) return content;

        // 1. Identify all lines belonging to this card
        let endIndex = cardLineIndex + 1;
        while (endIndex < lines.length) {
            const raw = lines[endIndex];
            const trimmed = raw.trim();
            // Stop if next top-level card (starts with - [ ] without leading indent)
            if (/^-\s+\[[ x]\]/.test(raw) && !/^\s+/.test(raw)) break;
            // Stop if next column heading
            if (/^##\s+/.test(trimmed)) break;
            // Stop if settings section
            if (/^%%\s*kanban:settings/i.test(trimmed)) break;
            endIndex++;
        }

        // Trim any trailing empty lines from the card chunk
        while (endIndex > cardLineIndex + 1 && lines[endIndex - 1].trim() === '') {
            endIndex--;
        }

        // Extract card lines
        const cardLines = lines.slice(cardLineIndex, endIndex);
        const cardChunkLen = endIndex - cardLineIndex;

        // Auto-complete if moving into Done column, or reopen if moving into an active work column
        if (cardLines.length > 0) {
            if (isDoneColumn(targetColumnName)) {
                cardLines[0] = cardLines[0].replace(/^-\s+\[\s*\]/, '- [x]');
            } else if (!isIgnoredColumn(targetColumnName)) {
                cardLines[0] = cardLines[0].replace(/^-\s+\[[xX]\]/, '- [ ]');
            }
        }

        // Remove card lines from original position
        lines.splice(cardLineIndex, cardChunkLen);

        // If targetLineIndex is provided and valid (dropped on a specific card)
        if (targetLineIndex !== -1 && targetLineIndex >= 0) {
            let adjustedTarget = targetLineIndex;
            if (cardLineIndex < targetLineIndex) {
                adjustedTarget = Math.max(0, targetLineIndex - cardChunkLen);
            }
            lines.splice(adjustedTarget, 0, ...cardLines, '');
            return lines.join('\n');
        }

        // 2. Find target column heading line
        const targetClean = targetColumnName.trim().toLowerCase().replace(/[\s-_]+/g, '');
        let targetHeadingIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (/^##\s+/.test(trimmed)) {
                const name = trimmed.replace(/^##\s+/, '').replace(/<!--[\s\S]*?-->/, '').trim();
                const nameClean = name.toLowerCase().replace(/[\s-_]+/g, '');
                if (nameClean === targetClean || name.toLowerCase() === targetColumnName.toLowerCase()) {
                    targetHeadingIndex = i;
                    break;
                }
            }
        }

        // If target column doesn't exist, create it before settings or at end
        if (targetHeadingIndex === -1) {
            const settingsIdx = lines.findIndex(l => /^%%\s*kanban:settings/i.test(l.trim()));
            if (settingsIdx !== -1) {
                lines.splice(settingsIdx, 0, '', `## ${targetColumnName}`, '');
                targetHeadingIndex = settingsIdx + 1;
            } else {
                lines.push('', `## ${targetColumnName}`, '');
                targetHeadingIndex = lines.length - 2;
            }
        }

        // Insert cardLines at TOP of the target column (right after ## Column heading)
        lines.splice(targetHeadingIndex + 1, 0, ...cardLines, '');

        return lines.join('\n');
    }

    /** Move a card relative to another card (above or below) */
    moveCardRelative(content, sourceCardLineIndex, targetCardLineIndex, position = 'above') {
        const lines = content.split('\n');
        if (sourceCardLineIndex < 0 || sourceCardLineIndex >= lines.length) return content;
        if (targetCardLineIndex < 0 || targetCardLineIndex >= lines.length) return content;
        if (sourceCardLineIndex === targetCardLineIndex) return content;

        // 1. Extract source card block
        let srcEnd = sourceCardLineIndex + 1;
        while (srcEnd < lines.length) {
            const raw = lines[srcEnd];
            const trimmed = raw.trim();
            if (/^-\s+\[[ x]\]/.test(raw) && !/^\s+/.test(raw)) break;
            if (/^##\s+/.test(trimmed) || /^%%\s*kanban:settings/i.test(trimmed)) break;
            srcEnd++;
        }
        while (srcEnd > sourceCardLineIndex + 1 && lines[srcEnd - 1].trim() === '') {
            srcEnd--;
        }
        const cardLines = lines.slice(sourceCardLineIndex, srcEnd);
        const cardChunkLen = srcEnd - sourceCardLineIndex;

        // Remove source card lines
        lines.splice(sourceCardLineIndex, cardChunkLen);

        // 2. Adjust target index if target was below source
        let adjustedTargetIndex = targetCardLineIndex;
        if (sourceCardLineIndex < targetCardLineIndex) {
            adjustedTargetIndex = Math.max(0, targetCardLineIndex - cardChunkLen);
        }

        // 3. Find insert point
        let insertPos = adjustedTargetIndex;
        if (position === 'below') {
            let tgtEnd = adjustedTargetIndex + 1;
            while (tgtEnd < lines.length) {
                const raw = lines[tgtEnd];
                const trimmed = raw.trim();
                if (/^-\s+\[[ x]\]/.test(raw) && !/^\s+/.test(raw)) break;
                if (/^##\s+/.test(trimmed) || /^%%\s*kanban:settings/i.test(trimmed)) break;
                tgtEnd++;
            }
            while (tgtEnd > adjustedTargetIndex + 1 && lines[tgtEnd - 1].trim() === '') {
                tgtEnd--;
            }
            insertPos = tgtEnd;
        }

        // Find which column this insertion point belongs to
        let targetColName = '';
        for (let i = insertPos; i >= 0; i--) {
            if (i < lines.length && /^##\s+/.test(lines[i].trim())) {
                targetColName = lines[i].trim().replace(/^##\s+/, '').replace(/<!--[\s\S]*?-->/, '').trim();
                break;
            }
        }

        // Auto-complete if moving into Done column, or reopen if moving into an active work column
        if (cardLines.length > 0) {
            if (isDoneColumn(targetColName)) {
                cardLines[0] = cardLines[0].replace(/^-\s+\[\s*\]/, '- [x]');
            } else if (targetColName && !isIgnoredColumn(targetColName)) {
                cardLines[0] = cardLines[0].replace(/^-\s+\[[xX]\]/, '- [ ]');
            }
        }

        // Insert cardLines
        lines.splice(insertPos, 0, ...cardLines);

        return lines.join('\n');
    }

    /** Get clean editable markdown text for a card */
    getCardEditableText(content, cardLineIndex) {
        const lines = content.split('\n');
        if (cardLineIndex < 0 || cardLineIndex >= lines.length) return '';

        let endIndex = cardLineIndex + 1;
        while (endIndex < lines.length) {
            const raw = lines[endIndex];
            const trimmed = raw.trim();
            if (/^-\s+\[[ x]\]/.test(raw) && !/^\s+/.test(raw)) break;
            if (/^##\s+/.test(trimmed) || /^%%\s*kanban:settings/i.test(trimmed)) break;
            endIndex++;
        }

        while (endIndex > cardLineIndex + 1 && lines[endIndex - 1].trim() === '') {
            endIndex--;
        }

        const blockLines = lines.slice(cardLineIndex, endIndex);
        if (blockLines.length === 0) return '';

        // Clean first line: remove '- [ ]', dates '@{...}', and hidden comments '<!-- ... -->'
        let firstLine = blockLines[0];
        firstLine = firstLine.replace(/^-\s+\[[ x]\]\s*/, '');
        firstLine = firstLine.replace(/@\{[\d-]+(?:\.\.[\d-]+)?\}/g, '');
        firstLine = firstLine.replace(/<!--[\s\S]*?-->/g, '');
        firstLine = firstLine.replace(/⏰\s*[\d-:]+(?:-[\d:]+)?/g, '');
        firstLine = firstLine.trim();

        const otherLines = blockLines.slice(1).map(l => {
            return l.replace(/^\t|^\s{2}/, '');
        });

        return [firstLine, ...otherLines].join('\n').trim();
    }

    /** Save updated card text and metadata */
    saveCardEdit(content, cardLineIndex, newText, targetColumn, origColumn, startDate, endDate, estimateText = null) {
        const lines = content.split('\n');
        if (cardLineIndex < 0 || cardLineIndex >= lines.length) return content;

        // 1. Identify original card bounds and preserve completion / existing metadata
        const origFirstLine = lines[cardLineIndex];
        const isCompleted = /^-\s+\[[xX]\]/.test(origFirstLine);
        const checkPrefix = isCompleted ? '- [x] ' : '- [ ] ';

        // Extract existing time block comments or metadata if present
        const commentMatch = origFirstLine.match(/<!--\s*(?:tb:?|⏰)\s*[\s\S]*?-->/);
        const commentTag = commentMatch ? ` ${commentMatch[0]}` : '';

        // Format dates
        let dateTag = '';
        if (startDate) {
            dateTag = sameDay(startDate, endDate || startDate)
                ? ` @{${formatDate(startDate)}}`
                : ` @{${formatDate(startDate)}..${formatDate(endDate || startDate)}}`;
        }

        // 2. Format new card lines
        const inputLines = (newText || '').split('\n');
        let firstLineBody = (inputLines[0] || '').trim();

        // If estimateText passed from modal and not already in firstLineBody
        if (estimateText && !/(?:~|est:|\(|\[)\d+/i.test(firstLineBody)) {
            firstLineBody = `${firstLineBody} ~${estimateText}`;
        }

        const headerLine = `${checkPrefix}${firstLineBody}${dateTag}${commentTag}`.trim();

        const formattedCardLines = [headerLine];
        for (let i = 1; i < inputLines.length; i++) {
            const rawL = inputLines[i];
            if (rawL.trim() === '') {
                formattedCardLines.push('');
            } else {
                formattedCardLines.push(`\t${rawL.replace(/^\t/, '')}`);
            }
        }

        // 3. Find end index of original card
        let endIndex = cardLineIndex + 1;
        while (endIndex < lines.length) {
            const raw = lines[endIndex];
            const trimmed = raw.trim();
            if (/^-\s+\[[ x]\]/.test(raw) && !/^\s+/.test(raw)) break;
            if (/^##\s+/.test(trimmed) || /^%%\s*kanban:settings/i.test(trimmed)) break;
            endIndex++;
        }
        while (endIndex > cardLineIndex + 1 && lines[endIndex - 1].trim() === '') {
            endIndex--;
        }

        // Replace card block in place
        lines.splice(cardLineIndex, endIndex - cardLineIndex, ...formattedCardLines);
        let updatedContent = lines.join('\n');

        // 4. Move to target column ONLY IF changed
        if (targetColumn && origColumn && targetColumn.trim().toLowerCase() !== origColumn.trim().toLowerCase()) {
            updatedContent = this.moveCardToColumn(updatedContent, cardLineIndex, targetColumn);
        }

        return updatedContent;
    }

    /** Add a new routine/event timeblock to the Kanban file */
    addTimeEvent(content, title, date, timeStart, timeEnd, eventType = 'break', seriesId = null) {
        return this.addTimeEventsBatch(content, [{ title, date, timeStart, timeEnd, eventType, seriesId }]);
    }

    /** Add multiple routine/event timeblocks to the Kanban file in one batch */
    addTimeEventsBatch(content, items) {
        if (!items || items.length === 0) return content;

        const cardLines = items.map(item => {
            const dateStr = formatDate(item.date);
            const seriesTag = item.seriesId ? ` series:${item.seriesId}` : '';
            return `- [ ] ${item.title} @{${dateStr}} <!-- tb: ${dateStr} ${item.timeStart}-${item.timeEnd} type:${item.eventType || 'break'}${seriesTag} -->`;
        });

        const lines = content.split('\n');
        let targetIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (/^##\s+(?:Rotina|Eventos|Timeblocks)/i.test(lines[i].trim())) {
                targetIdx = i;
                break;
            }
        }

        if (targetIdx !== -1) {
            lines.splice(targetIdx + 1, 0, ...cardLines);
        } else {
            let settingsIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (/^%%\s*kanban:settings/.test(lines[i].trim())) {
                    settingsIdx = i;
                    break;
                }
            }
            if (settingsIdx !== -1) {
                lines.splice(settingsIdx, 0, '', '## Rotina', '', ...cardLines, '');
            } else {
                lines.push('', '## Rotina', '', ...cardLines);
            }
        }
        return lines.join('\n');
    }

    /** Update all routine/event cards in a recurring series */
    updateTimeEventSeries(content, seriesId, titleMatch, newTitle, newTimeStart, newTimeEnd, newEventType = null, fromDate = null) {
        const lines = content.split('\n');
        const fromDateObj = fromDate ? startOfDay(fromDate) : null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!/^-\s+\[[ x]\]/.test(line)) continue;

            const hasSeries = seriesId && line.includes(`series:${seriesId}`);
            const hasTitleMatch = !seriesId && titleMatch && line.includes(titleMatch);

            if (hasSeries || hasTitleMatch) {
                const dateMatch = line.match(/@\{([\d-]+)/);
                if (fromDateObj && dateMatch) {
                    const cardDate = parseDate(dateMatch[1]);
                    if (cardDate && startOfDay(cardDate) < fromDateObj) continue;
                }

                let updatedLine = line;
                if (newTitle && titleMatch && newTitle !== titleMatch) {
                    updatedLine = updatedLine.replace(titleMatch, newTitle);
                }

                if (newTimeStart && newTimeEnd) {
                    const commentMatch = updatedLine.match(/<!--\s*(?:tb:?|⏰)\s*([\s\S]*?)-->/);
                    if (commentMatch) {
                        const dateStrMatch = commentMatch[1].match(/\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}/);
                        const curDateStr = dateStrMatch ? dateStrMatch[0] : (dateMatch ? dateMatch[1] : '');
                        const typeMatch = commentMatch[1].match(/type:([^\s]+)/);
                        const curType = newEventType || (typeMatch ? typeMatch[1] : 'break');
                        const sId = seriesId || (commentMatch[1].match(/series:([^\s]+)/) || [])[1] || '';
                        const sIdTag = sId ? ` series:${sId}` : '';

                        const newComment = `<!-- tb: ${curDateStr} ${newTimeStart}-${newTimeEnd} type:${curType}${sIdTag} -->`;
                        updatedLine = updatedLine.replace(/<!--\s*(?:tb:?|⏰)\s*[\s\S]*?-->/, newComment);
                    }
                }

                lines[i] = updatedLine;
            }
        }
        return lines.join('\n');
    }

    /** Delete all routine/event cards in a recurring series */
    deleteTimeEventSeries(content, seriesId, titleMatch, fromDate = null) {
        const lines = content.split('\n');
        const fromDateObj = fromDate ? startOfDay(fromDate) : null;
        const filtered = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!/^-\s+\[[ x]\]/.test(line)) {
                filtered.push(line);
                continue;
            }

            const hasSeries = seriesId && line.includes(`series:${seriesId}`);
            const hasTitleMatch = !seriesId && titleMatch && line.includes(titleMatch);

            if (hasSeries || hasTitleMatch) {
                if (fromDateObj) {
                    const dateMatch = line.match(/@\{([\d-]+)/);
                    if (dateMatch) {
                        const cardDate = parseDate(dateMatch[1]);
                        if (cardDate && startOfDay(cardDate) < fromDateObj) {
                            filtered.push(line);
                            continue;
                        }
                    }
                }
                // Skip line to delete it
                continue;
            }

            filtered.push(line);
        }
        return filtered.join('\n');
    }

    /** Replace or add a date range metadatum in a card line */
    updateDateRange(content, lineIndex, startDate, endDate) {
        const lines = content.split('\n');
        if (lineIndex >= lines.length) return content;
        let line = lines[lineIndex];
        const newDate = sameDay(startDate, endDate)
            ? `@{${formatDate(startDate)}}`
            : `@{${formatDate(startDate)}..${formatDate(endDate)}}`;

        if (/@\{[\d-]+(?:\.\.[\d-]+)?\}/.test(line)) {
            line = line.replace(/@\{[\d-]+(?:\.\.[\d-]+)?\}/, newDate);
        } else {
            line = line.trimEnd() + ' ' + newDate;
        }
        lines[lineIndex] = line;
        return lines.join('\n');
    }

    /** Remove date range and timeblocks from a card, putting it back in backlog */
    removeDateRange(content, lineIndex) {
        const lines = content.split('\n');
        if (lineIndex >= lines.length) return content;
        let line = lines[lineIndex];
        line = line.replace(/@\{[\d-]+(?:\.\.[\d-]+)?\}/g, '');
        line = line.replace(/<!--\s*(?:tb:?|⏰)\s*[\s\S]*?-->/g, '');
        line = line.replace(/⏰\s*\d{2}-\d{2}-\d{4}\s*[:\s]?\s*\d{2}:\d{2}-\d{2}:\d{2}/g, '');
        line = line.replace(/⏰\s*\d{2}:\d{2}-\d{2}:\d{2}/g, '');
        line = line.replace(/\s+/g, ' ').trimEnd();
        lines[lineIndex] = line;
        return lines.join('\n');
    }

    /** Replace or add a per-day time block metadatum in a card line (as hidden markdown comment) */
    updateTimeBlock(content, lineIndex, date, timeStart, timeEnd) {
        const lines = content.split('\n');
        if (lineIndex >= lines.length) return content;
        let line = lines[lineIndex];
        const targetDateStr = formatDate(date);

        // Read all existing daily times from comments or legacy tags
        const dailyMap = {};

        // 1. From comments
        const commentRegex = /<!--\s*(?:tb:?|⏰)\s*([\s\S]*?)-->/g;
        let cm;
        while ((cm = commentRegex.exec(line)) !== null) {
            const commentBody = cm[1];
            const innerDatedRegex = /(\d{2}-\d{2}-\d{4})\s*[:\s]?\s*(\d{2}:\d{2})-(\d{2}:\d{2})/g;
            let idm;
            let foundDated = false;
            while ((idm = innerDatedRegex.exec(commentBody)) !== null) {
                dailyMap[idm[1]] = `${idm[2]}-${idm[3]}`;
                foundDated = true;
            }
            if (!foundDated) {
                const innerSimpleRegex = /(?:^|\s)(\d{2}:\d{2})-(\d{2}:\d{2})/g;
                let ism;
                while ((ism = innerSimpleRegex.exec(commentBody)) !== null) {
                    const sStr = targetDateStr;
                    if (!dailyMap[sStr]) dailyMap[sStr] = `${ism[1]}-${ism[2]}`;
                }
            }
        }

        // 2. From legacy tags
        const datedRegex = /⏰\s*(\d{2}-\d{2}-\d{4})\s*[:\s]?\s*(\d{2}:\d{2})-(\d{2}:\d{2})/g;
        let match;
        while ((match = datedRegex.exec(line)) !== null) {
            dailyMap[match[1]] = `${match[2]}-${match[3]}`;
        }

        const simpleRegex = /⏰\s*(\d{2}:\d{2})-(\d{2}:\d{2})/;
        const simpleMatch = line.match(simpleRegex);

        const drm = line.match(/@\{(\d{2}-\d{2}-\d{4})\.\.(\d{2}-\d{2}-\d{4})\}/);
        const dsm = line.match(/@\{(\d{2}-\d{2}-\d{4})\}/);
        const isMultiDay = !!drm && drm[1] !== drm[2];

        if (simpleMatch && isMultiDay) {
            const cardStartStr = drm ? drm[1] : targetDateStr;
            if (!dailyMap[cardStartStr]) {
                dailyMap[cardStartStr] = `${simpleMatch[1]}-${simpleMatch[2]}`;
            }
        } else if (simpleMatch && !isMultiDay) {
            const cardStartStr = dsm ? dsm[1] : targetDateStr;
            if (!dailyMap[cardStartStr]) {
                dailyMap[cardStartStr] = `${simpleMatch[1]}-${simpleMatch[2]}`;
            }
        }

        // Update target date
        if (timeStart && timeEnd) {
            dailyMap[targetDateStr] = `${timeStart}-${timeEnd}`;
        } else {
            delete dailyMap[targetDateStr];
        }

        // Clean all old comments and legacy time tags from the line
        line = line.replace(/<!--\s*(?:tb:?|⏰)\s*[\s\S]*?-->/g, '');
        line = line.replace(/⏰\s*\d{2}-\d{2}-\d{4}\s*[:\s]?\s*\d{2}:\d{2}-\d{2}:\d{2}/g, '');
        line = line.replace(/⏰\s*\d{2}:\d{2}-\d{2}:\d{2}/g, '');
        line = line.replace(/\s+/g, ' ').trimEnd();

        // Format updated time tags into a clean, 100% invisible HTML comment
        const dateKeys = Object.keys(dailyMap).sort();
        if (dateKeys.length > 0) {
            const formattedBlocks = dateKeys.map(d => `${d} ${dailyMap[d]}`).join(' ');
            line = `${line} <!-- tb: ${formattedBlocks} -->`;
        }

        lines[lineIndex] = line;
        return lines.join('\n');
    }
}

// ================================================================
// CONFIRM DELETE MODAL (Native Obsidian Confirmation)
// ================================================================

class ConfirmDeleteModal extends obsidian.Modal {
    constructor(app, cardTitle, onConfirm) {
        super(app);
        this.cardTitle = cardTitle;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('kt-confirm-modal');
        contentEl.createEl('h2', { text: 'Excluir card' });
        contentEl.createEl('p', { text: `Deseja realmente excluir permanentemente o card "${this.cardTitle}"?` });

        const footer = contentEl.createDiv('kt-modal-footer');
        const cancelBtn = footer.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = footer.createEl('button', { cls: 'mod-warning', text: 'Excluir definitivamente' });
        confirmBtn.onclick = async () => {
            this.close();
            if (this.onConfirm) await this.onConfirm();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class ConfirmDeleteColumnModal extends obsidian.Modal {
    constructor(app, colName, cardCount, onConfirm) {
        super(app);
        this.colName = colName;
        this.cardCount = cardCount;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('kt-confirm-modal');
        contentEl.createEl('h2', { text: `Excluir coluna "${this.colName}"` });
        if (this.cardCount > 0) {
            contentEl.createEl('p', {
                text: `Esta coluna contém ${this.cardCount} ${this.cardCount === 1 ? 'tarefa' : 'tarefas'}. Deseja realmente excluir permanentemente a coluna e todo o seu conteúdo do arquivo Kanban?`
            });
        } else {
            contentEl.createEl('p', {
                text: `Deseja realmente excluir permanentemente a coluna "${this.colName}" do arquivo Kanban?`
            });
        }

        const footer = contentEl.createDiv('kt-modal-footer');
        const cancelBtn = footer.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = footer.createEl('button', { cls: 'mod-warning', text: 'Excluir Coluna' });
        confirmBtn.onclick = async () => {
            this.close();
            if (this.onConfirm) await this.onConfirm();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ================================================================
// DATE RANGE MODAL
// ================================================================

class DateRangeModal extends obsidian.Modal {
    constructor(app, card, onSave, onRemoveSchedule, onDeleteCard) {
        super(app);
        this.card             = card;
        this.onSave           = onSave;
        this.onRemoveSchedule = onRemoveSchedule;
        this.onDeleteCard     = onDeleteCard;
    }

    onOpen() {
        const { contentEl, card } = this;
        contentEl.addClass('kt-modal');
        contentEl.createEl('h2', { text: `Agendar: ${card.title}` });

        let startVal = card.startDate ? formatDate(card.startDate) : formatDate(new Date());
        let endVal   = card.endDate   ? formatDate(card.endDate)   : startVal;

        new obsidian.Setting(contentEl)
            .setName('Data de Início')
            .setDesc('Formato: DD-MM-YYYY')
            .addText(t => {
                t.setValue(startVal).setPlaceholder('15-08-2026');
                t.onChange(v => startVal = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Data de Fim')
            .setDesc('Igual ao início para tarefas de 1 dia')
            .addText(t => {
                t.setValue(endVal).setPlaceholder('18-08-2026');
                t.onChange(v => endVal = v);
            });

        // Footer
        const footer = contentEl.createDiv('kt-modal-footer');

        const leftGroup = footer.createDiv('kt-modal-footer-left');
        const deleteBtn = leftGroup.createEl('button', { cls: 'mod-warning', text: 'Deletar card' });
        deleteBtn.onclick = () => {
            this.close();
            new ConfirmDeleteModal(this.app, card.title, async () => {
                if (this.onDeleteCard) await this.onDeleteCard();
            }).open();
        };

        const rightGroup = footer.createDiv('kt-modal-footer-right');

        const editContentBtn = rightGroup.createEl('button', { text: 'Editar card' });
        editContentBtn.onclick = () => {
            this.close();
            if (this.onEditContent) {
                this.onEditContent();
            }
        };

        if (card.startDate) {
            const removeSchedBtn = rightGroup.createEl('button', { text: 'Remover do cronograma' });
            removeSchedBtn.onclick = () => {
                if (this.onRemoveSchedule) {
                    this.onRemoveSchedule();
                }
                this.close();
            };
        }

        const saveBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: 'Salvar' });
        saveBtn.onclick = () => {
            const s = parseDate(startVal);
            const e = parseDate(endVal);
            if (!s || !e) { new obsidian.Notice('Data inválida. Use DD-MM-YYYY'); return; }
            if (this.onSave) {
                this.onSave(s, e);
            }
            this.close();
        };

        const cancelBtn = rightGroup.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();
    }

    onClose() { this.contentEl.empty(); }
}

// ================================================================
// TAG & LINK SUGGESTER FOR CARD EDITORS
// ================================================================

class CardTextareaSuggester {
    constructor(app, textarea, getTags) {
        this.app = app;
        this.textarea = textarea;
        this.getTags = getTags;
        this.popupEl = null;
        this.selectedIndex = 0;
        this.matches = [];
        this.currentQuery = '';
        this.queryType = null; // 'tag'

        this.init();
    }

    init() {
        this.textarea.addEventListener('input', () => this.checkTrigger());
        this.textarea.addEventListener('keydown', (e) => this.onKeyDown(e), true);
        this.textarea.addEventListener('blur', () => {
            setTimeout(() => this.close(), 200);
        });
    }

    getAllTags() {
        const tagSet = new Set([
            'Dev', 'Design', 'Frontend', 'Backend',
            'Mid', 'Urgent', 'High', 'Low',
            'Polish', 'Bug', 'Feature', 'Life', 'Study'
        ]);

        try {
            if (this.app.metadataCache && this.app.metadataCache.getTags) {
                const tags = this.app.metadataCache.getTags();
                Object.keys(tags).forEach(t => {
                    const clean = t.replace(/^#/, '');
                    if (clean) tagSet.add(clean);
                });
            }
        } catch (e) {}

        if (this.getTags) {
            try {
                const extra = this.getTags() || [];
                extra.forEach(t => {
                    const clean = t.replace(/^#/, '');
                    if (clean) tagSet.add(clean);
                });
            } catch (e) {}
        }

        return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
    }

    checkTrigger() {
        const pos = this.textarea.selectionStart;
        const text = this.textarea.value.slice(0, pos);

        // 1. Check for link: [[something
        const linkMatch = text.match(/\[\[([^\]]*)$/);
        if (linkMatch) {
            const query = linkMatch[1];
            const qLower = query.toLowerCase();
            const allFiles = this.app.vault.getMarkdownFiles ? this.app.vault.getMarkdownFiles().map(f => f.basename) : [];

            this.matches = allFiles.filter(name => {
                if (!query) return true;
                return name.toLowerCase().includes(qLower);
            }).slice(0, 10);

            if (this.matches.length > 0) {
                this.queryType = 'link';
                this.currentQuery = query;
                this.show();
                return;
            }
        }

        // 2. Check for tag: #something
        const tagMatch = text.match(/(?:^|\s)#([\w-]*)$/);
        if (tagMatch) {
            const query = tagMatch[1];
            const allTags = this.getAllTags();
            const qLower = query.toLowerCase();

            this.matches = allTags.filter(t => {
                if (!query) return true;
                return t.toLowerCase().includes(qLower);
            }).slice(0, 10);

            if (this.matches.length > 0) {
                this.queryType = 'tag';
                this.currentQuery = query;
                this.show();
                return;
            }
        }

        this.close();
    }

    show() {
        if (!this.popupEl) {
            this.popupEl = document.createElement('div');
            this.popupEl.className = 'kt-suggest-popup suggestion-container';
            document.body.appendChild(this.popupEl);
        }

        this.popupEl.empty();
        this.selectedIndex = Math.min(this.selectedIndex, this.matches.length - 1);
        if (this.selectedIndex < 0) this.selectedIndex = 0;

        const rect = this.textarea.getBoundingClientRect();
        this.popupEl.style.position = 'fixed';
        this.popupEl.style.left = `${rect.left}px`;
        this.popupEl.style.top = `${rect.bottom + 4}px`;
        this.popupEl.style.zIndex = '9999';

        this.matches.forEach((item, idx) => {
            const el = this.popupEl.createDiv({
                cls: `kt-suggest-item suggestion-item ${idx === this.selectedIndex ? 'is-selected' : ''}`
            });

            // Highlight matching substring
            const q = this.currentQuery.toLowerCase();
            const iLower = item.toLowerCase();
            const matchIdx = q ? iLower.indexOf(q) : -1;

            if (matchIdx !== -1 && q) {
                const before = item.slice(0, matchIdx);
                const match = item.slice(matchIdx, matchIdx + q.length);
                const after = item.slice(matchIdx + q.length);

                if (before) el.createSpan().setText(before);
                el.createEl('strong', { text: match });
                if (after) el.createSpan().setText(after);
            } else {
                el.setText(item);
            }

            el.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.select(item);
            };
        });
    }

    onKeyDown(e) {
        if (!this.popupEl || this.matches.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            this.selectedIndex = (this.selectedIndex + 1) % this.matches.length;
            this.show();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            this.selectedIndex = (this.selectedIndex - 1 + this.matches.length) % this.matches.length;
            this.show();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (this.matches[this.selectedIndex]) {
                e.preventDefault();
                e.stopPropagation();
                this.select(this.matches[this.selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.close();
        }
    }

    select(item) {
        const pos = this.textarea.selectionStart;
        const text = this.textarea.value;
        const before = text.slice(0, pos);
        const after = text.slice(pos);

        if (this.queryType === 'tag') {
            const match = before.match(/(?:^|\s)#([\w-]*)$/);
            if (match) {
                const replaceStart = before.length - match[1].length;
                const newBefore = before.slice(0, replaceStart) + item + ' ';
                this.textarea.value = newBefore + after;
                this.textarea.selectionStart = this.textarea.selectionEnd = newBefore.length;
                this.textarea.focus();
                this.textarea.dispatchEvent(new Event('input'));
            }
        } else if (this.queryType === 'link') {
            const match = before.match(/\[\[([^\]]*)$/);
            if (match) {
                const replaceStart = before.length - match[1].length;
                const newBefore = before.slice(0, replaceStart) + item + ']] ';
                this.textarea.value = newBefore + after;
                this.textarea.selectionStart = this.textarea.selectionEnd = newBefore.length;
                this.textarea.focus();
                this.textarea.dispatchEvent(new Event('input'));
            }
        }

        this.close();
    }

    close() {
        if (this.popupEl) {
            this.popupEl.remove();
            this.popupEl = null;
        }
        this.matches = [];
        this.selectedIndex = 0;
    }
}

// ================================================================
// CARD OPTIONS MODAL (••• Menu for Column, Schedule, Delete)
// ================================================================

class CardOptionsModal extends obsidian.Modal {
    constructor(app, plugin, card, allColumns, initialText, onSave, onDelete, initialDayTime = null) {
        super(app);
        this.app        = app;
        this.plugin     = plugin;
        this.card       = card;
        this.allColumns = allColumns || [];
        this.initialText = initialText || card.title;
        this.onSave     = onSave;
        this.onDelete   = onDelete;
        this.initialDayTime = initialDayTime;
    }

    onOpen() {
        const { contentEl, card } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper');
        this.modalEl.style.width = '560px';
        this.modalEl.style.maxWidth = '94vw';
        contentEl.addClass('kt-card-edit-modal');
        contentEl.createEl('h2', { text: `Editar Tarefa / Opções` });

        // 1. Content Textarea (Title, Markdown, Images, Subtasks, Tags)
        const contentSection = contentEl.createDiv('kt-edit-content-section');
        contentSection.createEl('label', { cls: 'kt-edit-label', text: 'Conteúdo do Card (Markdown, Imagens e Subtarefas):' });

        const textarea = contentSection.createEl('textarea', {
            cls: 'kt-card-edit-textarea',
            attr: {
                placeholder: 'Escreva o título, cole imagens ![[imagem.png]], checklists - [ ] ou #tags...',
                rows: 6
            }
        });
        textarea.value = this.initialText;
        new CardTextareaSuggester(this.app, textarea, () => (this.plugin.settings.projects || []).map(p => p.tag).filter(Boolean));

        const helperHint = contentSection.createDiv('kt-edit-helper-hint');
        helperHint.setText('💡 Dica: Você pode colar imagens com ![[imagem.png]] e checklists com - [ ]');

        // 2. Column selector & schedule fields
        const metaSection = contentEl.createDiv('kt-edit-meta-section');

        let selectedCol = card.column;
        new obsidian.Setting(metaSection)
            .setName('Coluna do Kanban')
            .addDropdown(d => {
                this.allColumns.forEach(c => {
                    d.addOption(c, c);
                });
                d.setValue(card.column);
                d.onChange(v => selectedCol = v);
            });

        let startVal = card.startDate ? formatDate(card.startDate) : '';
        let endVal   = card.endDate   ? formatDate(card.endDate)   : startVal;

        const dateSetting = new obsidian.Setting(metaSection)
            .setName('Datas no Cronograma')
            .setDesc('Início e Fim (DD-MM-YYYY, deixe vazio para Backlog sem data)');
        
        dateSetting.addText(t => {
            t.setPlaceholder('Início (DD-MM-YYYY)').setValue(startVal).onChange(v => startVal = v.trim());
            t.inputEl.style.width = '130px';
        });
        dateSetting.addText(t => {
            t.setPlaceholder('Fim (DD-MM-YYYY)').setValue(endVal).onChange(v => endVal = v.trim());
            t.inputEl.style.width = '130px';
        });

        // Timeblocking Hours (Start – End)
        let tsVal = (this.initialDayTime?.timeStart) || card.timeStart || '';
        let teVal = (this.initialDayTime?.timeEnd)   || card.timeEnd   || '';
        const timeSetting = new obsidian.Setting(metaSection)
            .setName('Horário no Timeblocking')
            .setDesc('Horário agendado (ex: 15:30 – 17:30, calcula duração automaticamente)');
        
        timeSetting.addText(t => {
            t.setPlaceholder('Início (HH:MM)').setValue(tsVal).onChange(v => tsVal = v.trim());
            t.inputEl.style.width = '130px';
        });
        timeSetting.addText(t => {
            t.setPlaceholder('Fim (HH:MM)').setValue(teVal).onChange(v => teVal = v.trim());
            t.inputEl.style.width = '130px';
        });

        // Footer buttons
        const footer = contentEl.createDiv('kt-modal-footer');

        const leftGroup = footer.createDiv('kt-modal-footer-left');
        const deleteBtn = leftGroup.createEl('button', { cls: 'mod-warning', text: 'Deletar card' });
        deleteBtn.onclick = () => {
            this.close();
            new ConfirmDeleteModal(this.app, card.title, async () => {
                if (this.onDelete) await this.onDelete();
            }).open();
        };

        const rightGroup = footer.createDiv('kt-modal-footer-right');
        const cancelBtn = rightGroup.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: 'Salvar' });
        
        const doSave = async () => {
            const sDate = startVal ? parseDate(startVal) : null;
            const eDate = endVal   ? parseDate(endVal)   : sDate;
            const updatedText = textarea.value.trim() || card.title;
            this.close();
            if (this.onSave) await this.onSave(selectedCol, card.column, sDate, eDate, tsVal, teVal, updatedText);
        };

        saveBtn.onclick = doSave;
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ================================================================
// PROJECT MODAL (Novo Projeto / Editar Projeto)
// ================================================================

class ProjectModal extends obsidian.Modal {
    constructor(app, plugin, project, allColumns, onSave, onDelete) {
        super(app);
        this.app = app;
        this.plugin = plugin;
        this.project = project || null;
        this.allColumns = allColumns || [];
        this.onSave = onSave;
        this.onDelete = onDelete;
    }

    onOpen() {
        const { contentEl, project } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper');
        this.modalEl.style.width = '480px';
        this.modalEl.style.maxWidth = '92vw';
        contentEl.addClass('kt-card-edit-modal');
        contentEl.createEl('h2', { text: project ? `Editar Projeto: ${project.name}` : 'Novo Projeto' });

        let name = project ? project.name : '';
        let tag = project ? project.tag : '';
        let selectedCol = project && project.columns && project.columns.length > 0 ? project.columns[0] : '';
        let color = project ? project.color : '#6366f1';
        let targetHours = project ? project.targetHours || 0 : 0;
        let hourlyRate = project ? project.hourlyRate || 0 : 0;
        let currency = project ? project.currency || 'R$' : 'R$';
        let awPattern = project ? project.awPattern || '' : '';

        new obsidian.Setting(contentEl)
            .setName('Nome do Projeto')
            .setDesc('Nome legível do projeto (ex: Meu Projeto, Website, App)')
            .addText(t => {
                t.setPlaceholder('ex: Website').setValue(name).onChange(v => name = v.trim());
            });

        new obsidian.Setting(contentEl)
            .setName('Hashtag Associada')
            .setDesc('Hashtag usada nos cards (ex: #projeto ou #dev)')
            .addText(t => {
                t.setPlaceholder('ex: #projeto').setValue(tag).onChange(v => {
                    let clean = v.trim();
                    if (clean && !clean.startsWith('#')) clean = '#' + clean;
                    tag = clean;
                });
            });

        new obsidian.Setting(contentEl)
            .setName('Filtro no ActivityWatch (Opcional)')
            .setDesc('Palavras-chave ou termos para identificar janelas deste projeto no ActivityWatch (ex: Unity, Figma, Code, Chrome). Separar por vírgula. Deixe vazio para usar o nome/hashtag.')
            .addText(t => {
                t.setPlaceholder('ex: Unity, Figma, Code').setValue(awPattern).onChange(v => awPattern = v.trim());
            });

        new obsidian.Setting(contentEl)
            .setName('Coluna do Kanban (Opcional)')
            .setDesc('Coluna onde ficam as tarefas deste projeto')
            .addDropdown(d => {
                d.addOption('', '(Nenhuma coluna específica)');
                this.allColumns.forEach(c => {
                    if (c !== 'Done' && c !== 'Rotina') d.addOption(c, c);
                });
                d.setValue(selectedCol);
                d.onChange(v => selectedCol = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Valor da Hora (Ganhos)')
            .setDesc('Valor cobrado/ganho por hora trabalhada (ex: 80, 150)')
            .addText(t => {
                t.setPlaceholder('ex: 80').setValue(hourlyRate ? String(hourlyRate) : '').onChange(v => {
                    hourlyRate = parseFloat(v.replace(',', '.')) || 0;
                });
            });

        new obsidian.Setting(contentEl)
            .setName('Moeda')
            .setDesc('Símbolo da moeda')
            .addDropdown(d => {
                d.addOption('R$', 'R$ (Real Brasileiro)');
                d.addOption('$', '$ (Dólar Americano)');
                d.addOption('€', '€ (Euro)');
                d.addOption('£', '£ (Libra Esterlina)');
                d.setValue(currency);
                d.onChange(v => currency = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Cor de Identificação')
            .setDesc('Cor do projeto nos gráficos e badges')
            .addColorPicker(cp => {
                cp.setValue(color).onChange(v => color = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Meta de Horas (Opcional)')
            .setDesc('Objetivo estimado de horas totais para o projeto')
            .addText(t => {
                t.setPlaceholder('ex: 50').setValue(targetHours ? String(targetHours) : '').onChange(v => {
                    targetHours = parseFloat(v) || 0;
                });
            });

        const footer = contentEl.createDiv('kt-modal-footer');
        const leftGroup = footer.createDiv('kt-modal-footer-left');
        if (project && this.onDelete) {
            const deleteBtn = leftGroup.createEl('button', { cls: 'mod-warning', text: 'Excluir Projeto' });
            deleteBtn.onclick = () => {
                this.close();
                this.onDelete();
            };
        }

        const rightGroup = footer.createDiv('kt-modal-footer-right');
        const cancelBtn = rightGroup.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: 'Salvar Projeto' });
        saveBtn.onclick = async () => {
            if (!name) {
                new obsidian.Notice('Por favor, informe o nome do projeto.');
                return;
            }
            this.close();
            const projData = {
                id: project ? project.id : 'proj-' + Date.now(),
                name,
                tag,
                columns: selectedCol ? [selectedCol] : [],
                color,
                targetHours,
                hourlyRate,
                currency,
                awPattern
            };
            if (this.onSave) await this.onSave(projData);
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ================================================================
// PROJECT REPORT MODAL (Discriminado de Horas, Tarefas e Datas para Enviar ao Chefe)
// ================================================================

class ProjectReportModal extends obsidian.Modal {
    constructor(app, plugin, project, cards, view) {
        super(app);
        this.app = app;
        this.plugin = plugin;
        this.project = project;
        this.cards = cards || [];
        this.view = view;
        this.periodFilter = 'all'; // 'all', 'month', 'week', 'today'
        this.statusFilter = 'all'; // 'all', 'done', 'pending'
        this.groupMode = 'date';   // 'date', 'task'
    }

    onOpen() {
        this.modalEl.addClass('kt-card-edit-modal-wrapper', 'kt-report-modal-wrapper');
        this.modalEl.style.width = '820px';
        this.modalEl.style.maxWidth = '94vw';
        this.modalEl.style.maxHeight = '90vh';
        this.renderModal();
    }

    getReportEntries() {
        const project = this.project;
        const projTag = (project.tag || '').trim().toLowerCase().replace(/^#/, '');
        const projCols = (project.columns || []).map(c => c.toLowerCase());
        const excludedSet = new Set(project.excludedTaskTitles || []);

        const matchingCards = this.cards.filter(c => {
            if (c.isEvent || c.column === 'Rotina') return false;
            const hasTag = projTag && c.tags.some(t => t.toLowerCase().replace(/^#/, '') === projTag);
            const inCol  = projCols.length > 0 && projCols.includes((c.column || '').toLowerCase());
            const hasTitleTag = projTag && c.title.toLowerCase().includes('#' + projTag);
            return hasTag || inCol || hasTitleTag;
        });

        const now = new Date();
        const startOfThisWeek = this.view ? this.view.getWeekStart() : startOfWeek(now);
        const endOfThisWeek = new Date(startOfThisWeek);
        endOfThisWeek.setDate(endOfThisWeek.getDate() + 7);

        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const entries = [];

        matchingCards.forEach(c => {
            const isDone = c.isCompleted || c.column === 'Done' || isIgnoredColumn(c.column);
            const isExcluded = excludedSet.has(c.title.trim());
            if (isExcluded) return; // Skip excluded tasks

            if (this.statusFilter === 'done' && !isDone) return;
            if (this.statusFilter === 'pending' && isDone) return;

            const dKeys = Object.keys(c.dailyTimes || {});
            if (dKeys.length > 0) {
                for (const dKey of dKeys) {
                    const dt = c.dailyTimes[dKey];
                    const slotDate = parseDate(dKey);
                    
                    if (slotDate) {
                        if (this.periodFilter === 'today' && !sameDay(slotDate, now)) continue;
                        if (this.periodFilter === 'week' && (slotDate < startOfThisWeek || slotDate >= endOfThisWeek)) continue;
                        if (this.periodFilter === 'month' && (slotDate < startOfMonth || slotDate > endOfMonth)) continue;
                    }

                    if (dt.timeStart && dt.timeEnd) {
                        const dur = timeToMinutes(dt.timeEnd) - timeToMinutes(dt.timeStart);
                        if (dur > 0) {
                            entries.push({
                                card: c,
                                title: c.title,
                                dateStr: dKey,
                                dateObj: slotDate || now,
                                timeStart: dt.timeStart,
                                timeEnd: dt.timeEnd,
                                durationMinutes: dur,
                                isDone,
                                column: c.column
                            });
                        }
                    }
                }
            } else if (c.timeStart && c.timeEnd) {
                const dur = timeToMinutes(c.timeEnd) - timeToMinutes(c.timeStart);
                if (dur > 0) {
                    const slotDate = c.startDate ? startOfDay(c.startDate) : null;
                    if (slotDate) {
                        if (this.periodFilter === 'today' && !sameDay(slotDate, now)) return;
                        if (this.periodFilter === 'week' && (slotDate < startOfThisWeek || slotDate >= endOfThisWeek)) return;
                        if (this.periodFilter === 'month' && (slotDate < startOfMonth || slotDate > endOfMonth)) return;
                    }

                    entries.push({
                        card: c,
                        title: c.title,
                        dateStr: slotDate ? formatDate(slotDate) : 'Geral',
                        dateObj: slotDate || now,
                        timeStart: c.timeStart,
                        timeEnd: c.timeEnd,
                        durationMinutes: dur,
                        isDone,
                        column: c.column
                    });
                }
            } else if (c.estimateMinutes && c.estimateMinutes > 0) {
                const slotDate = c.startDate ? startOfDay(c.startDate) : null;
                if (slotDate) {
                    if (this.periodFilter === 'today' && !sameDay(slotDate, now)) return;
                    if (this.periodFilter === 'week' && (slotDate < startOfThisWeek || slotDate >= endOfThisWeek)) return;
                    if (this.periodFilter === 'month' && (slotDate < startOfMonth || slotDate > endOfMonth)) return;
                } else if (this.periodFilter !== 'all') {
                    return;
                }

                entries.push({
                    card: c,
                    title: c.title,
                    dateStr: slotDate ? formatDate(slotDate) : 'Sem data',
                    dateObj: slotDate || new Date(0),
                    timeStart: null,
                    timeEnd: null,
                    durationMinutes: c.estimateMinutes,
                    isDone,
                    column: c.column
                });
            } else {
                if (this.periodFilter === 'all') {
                    const slotDate = c.startDate ? startOfDay(c.startDate) : null;
                    entries.push({
                        card: c,
                        title: c.title,
                        dateStr: slotDate ? formatDate(slotDate) : 'Sem data',
                        dateObj: slotDate || new Date(0),
                        timeStart: null,
                        timeEnd: null,
                        durationMinutes: 0,
                        isDone,
                        column: c.column
                    });
                }
            }
        });

        // Sort descending by date (most recent first)
        entries.sort((a, b) => {
            const timeA = a.dateObj ? a.dateObj.getTime() : 0;
            const timeB = b.dateObj ? b.dateObj.getTime() : 0;
            if (timeB !== timeA) return timeB - timeA;
            if (a.timeStart && b.timeStart) return a.timeStart.localeCompare(b.timeStart);
            return a.title.localeCompare(b.title);
        });

        return entries;
    }

    renderModal() {
        const { contentEl, project } = this;
        contentEl.empty();
        contentEl.addClass('kt-report-modal');

        const entries = this.getReportEntries();
        const totalMinutes = entries.reduce((acc, e) => acc + (e.durationMinutes || 0), 0);
        const totalEarnings = (totalMinutes / 60) * (project.hourlyRate || 0);
        const doneCount = entries.filter(e => e.isDone).length;
        const totalTasks = entries.length;
        const curr = project.currency || 'R$';

        // 1. Top Header Banner
        const topHdr = contentEl.createDiv('kt-report-header');
        
        const titleRow = topHdr.createDiv('kt-report-title-row');
        const projBadge = titleRow.createDiv('kt-report-proj-badge');
        const dot = projBadge.createSpan('kt-report-color-dot');
        dot.style.backgroundColor = project.color || '#6366f1';
        projBadge.createEl('h2', { cls: 'kt-report-proj-title', text: `Relatório de Horas: ${project.name}` });
        if (project.tag) {
            projBadge.createSpan({ cls: 'kt-report-tag-pill', text: project.tag });
        }

        const closeBtn = titleRow.createEl('button', { cls: 'kt-report-close-btn', text: '✕' });
        closeBtn.title = 'Fechar Relatório (Esc)';
        closeBtn.onclick = () => this.close();

        // 2. Filter Bar (Período, Status, Agrupamento)
        const filterBar = contentEl.createDiv('kt-report-filter-bar');

        // Period filter group
        const periodGrp = filterBar.createDiv('kt-report-btn-group');
        const periods = [
            { id: 'all', label: 'Tudo' },
            { id: 'month', label: 'Este Mês' },
            { id: 'week', label: 'Esta Semana' },
            { id: 'today', label: 'Hoje' }
        ];
        periods.forEach(p => {
            const btn = periodGrp.createEl('button', {
                cls: `kt-report-filter-btn ${this.periodFilter === p.id ? 'is-active' : ''}`,
                text: p.label
            });
            btn.onclick = () => {
                this.periodFilter = p.id;
                this.renderModal();
            };
        });

        // Status filter group
        const statusGrp = filterBar.createDiv('kt-report-btn-group');
        const statuses = [
            { id: 'all', label: 'Todas' },
            { id: 'done', label: 'Concluídas' },
            { id: 'pending', label: 'Pendentes' }
        ];
        statuses.forEach(s => {
            const btn = statusGrp.createEl('button', {
                cls: `kt-report-filter-btn ${this.statusFilter === s.id ? 'is-active' : ''}`,
                text: s.label
            });
            btn.onclick = () => {
                this.statusFilter = s.id;
                this.renderModal();
            };
        });

        // Grouping toggle group
        const groupGrp = filterBar.createDiv('kt-report-btn-group');
        const groups = [
            { id: 'date', label: 'Por Data' },
            { id: 'task', label: 'Por Tarefa' }
        ];
        groups.forEach(g => {
            const btn = groupGrp.createEl('button', {
                cls: `kt-report-filter-btn ${this.groupMode === g.id ? 'is-active' : ''}`,
                text: g.label
            });
            btn.onclick = () => {
                this.groupMode = g.id;
                this.renderModal();
            };
        });

        // 3. KPI Summary Row
        const kpiRow = contentEl.createDiv('kt-report-kpi-row');

        const kpi1 = kpiRow.createDiv('kt-report-kpi-card');
        kpi1.createDiv('kt-report-kpi-val').setText(formatMinutesToHours(totalMinutes) || '0h');
        kpi1.createDiv('kt-report-kpi-lbl').setText(`Total de Horas (${(totalMinutes / 60).toFixed(2)}h)`);

        if (project.hourlyRate > 0) {
            const kpi2 = kpiRow.createDiv('kt-report-kpi-card kt-kpi-green');
            kpi2.createDiv('kt-report-kpi-val').setText(formatCurrency(totalEarnings, curr));
            kpi2.createDiv('kt-report-kpi-lbl').setText(`Valor Total (${curr} ${project.hourlyRate}/h)`);
        }

        const kpi3 = kpiRow.createDiv('kt-report-kpi-card');
        const pctDone = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;
        kpi3.createDiv('kt-report-kpi-val').setText(`${doneCount} / ${totalTasks} (${pctDone}%)`);
        kpi3.createDiv('kt-report-kpi-lbl').setText('Tarefas Concluídas');

        // 4. Action Export Buttons (Pronto para enviar ao chefe)
        const actionsBar = contentEl.createDiv('kt-report-actions-bar');

        const copyMsgBtn = actionsBar.createEl('button', {
            cls: 'kt-report-act-btn kt-btn-copy-msg mod-cta',
            text: 'Copiar Mensagem'
        });
        copyMsgBtn.title = 'Copiar lista limpa de tarefas por dia pronta para enviar';
        copyMsgBtn.onclick = async () => {
            const txt = this.generateSummaryText(entries);
            await navigator.clipboard.writeText(txt);
            new obsidian.Notice('✓ Mensagem copiada!');
        };

        const copyMdBtn = actionsBar.createEl('button', {
            cls: 'kt-report-act-btn',
            text: 'Copiar Tabela Markdown'
        });
        copyMdBtn.title = 'Copiar como tabela Markdown detalhada com horas, datas e status';
        copyMdBtn.onclick = async () => {
            const md = this.generateMarkdownTable(entries, totalMinutes, totalEarnings);
            await navigator.clipboard.writeText(md);
            new obsidian.Notice('✓ Tabela Markdown copiada!');
        };

        const exportCsvBtn = actionsBar.createEl('button', {
            cls: 'kt-report-act-btn',
            text: 'Exportar CSV'
        });
        exportCsvBtn.title = 'Baixar arquivo CSV compatível com Excel e Google Planilhas';
        exportCsvBtn.onclick = () => this.exportCSV(entries);

        // 5. Itemized Breakdown Content (Discriminado Detalhado)
        const breakdownSection = contentEl.createDiv('kt-report-breakdown-section');
        const breakdownHdr = breakdownSection.createDiv('kt-report-breakdown-hdr');
        breakdownHdr.createEl('h3', { text: `Discriminado de Atividades (${entries.length} itens)` });

        const breakdownList = breakdownSection.createDiv('kt-report-breakdown-list');

        if (entries.length === 0) {
            breakdownList.createDiv('kt-report-empty').setText('Nenhum registro encontrado para os filtros selecionados.');
            return;
        }

        if (this.groupMode === 'date') {
            // Group by Date
            const byDate = {};
            entries.forEach(e => {
                const k = e.dateStr || 'Geral';
                if (!byDate[k]) byDate[k] = [];
                byDate[k].push(e);
            });

            const sortedDates = Object.keys(byDate).sort((a, b) => {
                if (a === 'Geral' || a === 'Sem data') return 1;
                if (b === 'Geral' || b === 'Sem data') return -1;
                return b.localeCompare(a);
            });

            sortedDates.forEach(dKey => {
                const list = byDate[dKey];
                const dayMinutes = list.reduce((acc, x) => acc + (x.durationMinutes || 0), 0);
                const dayEarnings = (dayMinutes / 60) * (project.hourlyRate || 0);

                let headerDate = dKey;
                const parsed = parseDate(dKey);
                if (parsed) {
                    const daysOfWeek = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
                    const dayName = daysOfWeek[parsed.getDay()];
                    const parts = dKey.split('-');
                    if (parts.length === 3) headerDate = `${parts[2]}/${parts[1]}/${parts[0]} (${dayName})`;
                }

                const dayBlock = breakdownList.createDiv('kt-report-day-block');
                
                const dayHdr = dayBlock.createDiv('kt-report-day-hdr');
                dayHdr.createSpan({ cls: 'kt-report-day-title', text: headerDate });
                
                const dayMetrics = dayHdr.createDiv('kt-report-day-metrics');
                dayMetrics.createSpan({ cls: 'kt-report-day-hours', text: formatMinutesToHours(dayMinutes) || '0h' });
                if (project.hourlyRate > 0) {
                    dayMetrics.createSpan({ cls: 'kt-report-day-val', text: formatCurrency(dayEarnings, curr) });
                }

                const dayItems = dayBlock.createDiv('kt-report-day-items');
                list.forEach(item => {
                    const rowEl = dayItems.createDiv(`kt-report-item-row ${item.isDone ? 'is-done' : ''}`);
                    
                    const left = rowEl.createDiv('kt-report-item-left');
                    const chk = left.createSpan({ cls: 'kt-report-item-chk', text: item.isDone ? '✓' : '○' });
                    if (item.timeStart && item.timeEnd) {
                        left.createSpan({ cls: 'kt-report-item-time-range', text: `${item.timeStart} - ${item.timeEnd}` });
                    }
                    left.createSpan({ cls: 'kt-report-item-title', text: item.title });

                    const right = rowEl.createDiv('kt-report-item-right');
                    right.createSpan({ cls: 'kt-report-item-col', text: item.column });
                    if (item.durationMinutes > 0) {
                        right.createSpan({ cls: 'kt-report-item-dur', text: formatMinutesToHours(item.durationMinutes) });
                        if (project.hourlyRate > 0) {
                            const itemEarned = (item.durationMinutes / 60) * project.hourlyRate;
                            right.createSpan({ cls: 'kt-report-item-earned', text: formatCurrency(itemEarned, curr) });
                        }
                    }
                    right.createSpan({ cls: `kt-report-item-status ${item.isDone ? 'is-done' : 'is-pending'}`, text: item.isDone ? 'Concluído' : 'Pendente' });
                });
            });
        } else {
            // Group by Task
            const byTask = {};
            entries.forEach(e => {
                if (!byTask[e.title]) {
                    byTask[e.title] = {
                        card: e.card,
                        title: e.title,
                        isDone: e.isDone,
                        column: e.column,
                        dates: new Set(),
                        totalMinutes: 0,
                        sessions: []
                    };
                }
                byTask[e.title].totalMinutes += (e.durationMinutes || 0);
                if (e.dateStr && e.dateStr !== 'Geral' && e.dateStr !== 'Sem data') {
                    byTask[e.title].dates.add(e.dateStr);
                }
                byTask[e.title].sessions.push(e);
            });

            const sortedTasks = Object.values(byTask).sort((a, b) => b.totalMinutes - a.totalMinutes);

            sortedTasks.forEach(t => {
                const taskBlock = breakdownList.createDiv(`kt-report-task-block ${t.isDone ? 'is-done' : ''}`);
                
                const taskHdr = taskBlock.createDiv('kt-report-task-hdr');
                const left = taskHdr.createDiv('kt-report-task-left');
                left.createSpan({ cls: 'kt-report-item-chk', text: t.isDone ? '✓' : '○' });
                left.createSpan({ cls: 'kt-report-task-title', text: t.title });

                const datesArr = Array.from(t.dates).sort();
                if (datesArr.length > 0) {
                    const datesStr = datesArr.map(d => {
                        const parts = d.split('-');
                        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
                    }).join(', ');
                    left.createSpan({ cls: 'kt-report-task-dates', text: datesStr });
                }

                const right = taskHdr.createDiv('kt-report-task-right');
                right.createSpan({ cls: 'kt-report-item-col', text: t.column });
                right.createSpan({ cls: 'kt-report-item-dur', text: formatMinutesToHours(t.totalMinutes) || '0h' });
                if (project.hourlyRate > 0) {
                    const taskEarned = (t.totalMinutes / 60) * project.hourlyRate;
                    right.createSpan({ cls: 'kt-report-item-earned', text: formatCurrency(taskEarned, curr) });
                }
                right.createSpan({ cls: `kt-report-item-status ${t.isDone ? 'is-done' : 'is-pending'}`, text: t.isDone ? 'Concluído' : 'Pendente' });
            });
        }
    }

    generateSummaryText(entries) {
        if (!entries || entries.length === 0) return 'Nenhuma atividade registrada.';

        if (this.groupMode === 'task') {
            const byTask = {};
            entries.forEach(e => {
                const title = (e.title || '').trim();
                if (!byTask[title]) byTask[title] = true;
            });
            return Object.keys(byTask).map(t => `• ${t}`).join('\n');
        }

        // Group by date (chronological order: oldest to newest)
        const byDate = {};
        entries.forEach(e => {
            const k = e.dateStr || 'Sem data';
            if (!byDate[k]) byDate[k] = new Set();
            byDate[k].add((e.title || '').trim());
        });

        const sortedDates = Object.keys(byDate).sort((a, b) => {
            if (a === 'Sem data' || a === 'Geral') return 1;
            if (b === 'Sem data' || b === 'Geral') return -1;
            return a.localeCompare(b); // Ascending: Segunda -> Terça -> Quarta
        });

        const sections = [];
        sortedDates.forEach(dKey => {
            let headerDate = dKey;
            const parsed = parseDate(dKey);
            if (parsed) {
                const daysOfWeek = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
                const dayName = daysOfWeek[parsed.getDay()];
                const parts = dKey.split('-');
                if (parts.length === 3) headerDate = `${dayName} (${parts[2]}/${parts[1]}/${parts[0]})`;
            }

            const tasksList = Array.from(byDate[dKey]).map(t => `• ${t}`).join('\n');
            sections.push(`${headerDate}\n${tasksList}`);
        });

        return sections.join('\n\n');
    }

    generateMarkdownTable(entries, totalMinutes, totalEarnings) {
        const p = this.project;
        const curr = p.currency || 'R$';
        let md = `### Relatório de Horas: ${p.name}\n\n`;
        md += `- **Projeto:** ${p.name} ${p.tag ? `(\`${p.tag}\`)` : ''}\n`;
        md += `- **Total de Horas:** ${formatMinutesToHours(totalMinutes)} (${(totalMinutes/60).toFixed(2)}h)\n`;
        if (p.hourlyRate > 0) {
            md += `- **Valor Total:** ${formatCurrency(totalEarnings, curr)} (${curr} ${p.hourlyRate}/h)\n`;
        }
        md += `\n| Data | Horário | Tarefa | Duração | Status |${p.hourlyRate > 0 ? ' Valor |' : ''}\n`;
        md += `| :--- | :--- | :--- | :--- | :--- |${p.hourlyRate > 0 ? ' :--- |' : ''}\n`;

        entries.forEach(e => {
            const timeRange = (e.timeStart && e.timeEnd) ? `${e.timeStart} - ${e.timeEnd}` : '-';
            const durStr = formatMinutesToHours(e.durationMinutes) || '0h';
            const statusStr = e.isDone ? 'Concluído' : 'Pendente';
            const valStr = p.hourlyRate > 0 ? formatCurrency((e.durationMinutes / 60) * p.hourlyRate, curr) : '';
            
            let dateFormatted = e.dateStr;
            if (e.dateStr && e.dateStr.includes('-')) {
                const parts = e.dateStr.split('-');
                if (parts.length === 3) dateFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
            }

            md += `| ${dateFormatted} | ${timeRange} | ${e.title.replace(/\|/g, '-')} | ${durStr} | ${statusStr} |${p.hourlyRate > 0 ? ` ${valStr} |` : ''}\n`;
        });

        return md;
    }

    exportCSV(entries) {
        const p = this.project;
        let csv = '\uFEFF'; // UTF-8 BOM for Excel
        csv += 'Data;Horario;Tarefa;Duracao_Minutos;Duracao_Horas_Formatada;Horas_Decimais;Status;Coluna';
        if (p.hourlyRate > 0) csv += ';Valor_Hora;Valor_Total';
        csv += '\n';

        entries.forEach(e => {
            const timeRange = (e.timeStart && e.timeEnd) ? `${e.timeStart} - ${e.timeEnd}` : '';
            const durStr = formatMinutesToHours(e.durationMinutes) || '0h';
            const decimal = (e.durationMinutes / 60).toFixed(2).replace('.', ',');
            const statusStr = e.isDone ? 'Concluído' : 'Pendente';
            const col = (e.column || '').replace(/;/g, ' ');
            const safeTitle = `"${(e.title || '').replace(/"/g, '""')}"`;
            
            let row = `${e.dateStr};${timeRange};${safeTitle};${e.durationMinutes};${durStr};${decimal};${statusStr};${col}`;
            if (p.hourlyRate > 0) {
                const val = ((e.durationMinutes / 60) * p.hourlyRate).toFixed(2).replace('.', ',');
                row += `;${p.hourlyRate};${val}`;
            }
            csv += row + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const fileName = `Relatorio_${p.name.replace(/\s+/g, '_')}_${formatDate(new Date())}.csv`;
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        new obsidian.Notice(`✓ Arquivo CSV exportado: ${fileName}`);
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ================================================================
// HABIT MODAL (Novo Hábito / Editar Hábito)
// ================================================================

class HabitModal extends obsidian.Modal {
    constructor(app, plugin, habit, onSave, onDelete) {
        super(app);
        this.app = app;
        this.plugin = plugin;
        this.habit = habit || null;
        this.onSave = onSave;
        this.onDelete = onDelete;
    }

    onOpen() {
        const { contentEl, habit } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper');
        this.modalEl.style.width = '480px';
        this.modalEl.style.maxWidth = '92vw';
        contentEl.addClass('kt-card-edit-modal');
        contentEl.createEl('h2', { text: habit ? `Editar Hábito: ${habit.name}` : 'Novo Hábito' });

        let name = habit ? habit.name : '';
        let icon = habit ? habit.icon : '✨';
        let type = habit ? habit.type : 'boolean';
        let target = habit ? habit.target || 1 : 1;
        let unit = habit ? habit.unit || '' : '';
        let color = habit ? habit.color : '#6366f1';
        let awFilter = habit ? (habit.awFilter || '') : '';

        new obsidian.Setting(contentEl)
            .setName('Nome do Hábito')
            .setDesc('Ex: Treino de Boxe, Beber Água, Leitura')
            .addText(t => {
                t.setPlaceholder('Nome do hábito').setValue(name).onChange(v => name = v.trim());
            });

        new obsidian.Setting(contentEl)
            .setName('Ícone / Emoji')
            .setDesc('Emoji representativo (ex: 🥊, 💧, 📖, 🧘, 💻, 🏃)')
            .addText(t => {
                t.setPlaceholder('ex: 🥊').setValue(icon).onChange(v => icon = v.trim() || '✨');
            });

        const targetSetting = new obsidian.Setting(contentEl)
            .setName('Meta Diária')
            .setDesc('Meta diária');

        const unitSetting = new obsidian.Setting(contentEl)
            .setName('Unidade de Medida')
            .setDesc('Ex: copos, páginas, min, km, vezes');

        let targetInputEl;
        targetSetting.addText(t => {
            targetInputEl = t;
            t.setPlaceholder('1').setValue(String(target)).onChange(v => {
                target = parseFloat(v) || 1;
            });
        });

        let unitInputEl;
        unitSetting.addText(t => {
            unitInputEl = t;
            t.setPlaceholder('vezes, copos, min').setValue(unit).onChange(v => unit = v.trim());
        });

        const awSetting = new obsidian.Setting(contentEl)
            .setName('🎯 Categoria / Projeto no ActivityWatch')
            .setDesc('Selecione a categoria ou projeto do ActivityWatch para contabilizar as horas automaticamente.');
        
        let awDropdown;
        awSetting.addDropdown(d => {
            awDropdown = d;
            d.addOption('', '— Nenhum (Desativado / Manual) —');
            if (awFilter) {
                d.addOption(awFilter, awFilter);
            }
            d.setValue(awFilter || '');
            d.onChange(v => {
                awFilter = v;
            });
        });

        // Asynchronously populate options from ActivityWatch & Projects
        const loadAwCategoriesIntoModal = async () => {
            if (!this.plugin.settings.awConnected) return;
            const host = this.plugin.settings.awHost || 'http://127.0.0.1:5600';
            const categoriesMap = new Map();
            categoriesMap.set('', '— Nenhum (Desativado / Manual) —');

            try {
                const res = await obsidian.requestUrl({ url: `${host}/api/0/settings` });
                const classes = res.json?.classes || [];
                classes.forEach(c => {
                    if (c.name && Array.isArray(c.name) && c.name.length > 0) {
                        const fullName = c.name.join(' > ');
                        categoriesMap.set(fullName, `🏷️ ${fullName}`);
                    }
                });
            } catch (e) {
                console.warn('[Kanban Timeline] Não foi possível buscar categorias do AW para o modal:', e);
            }

            // Add projects from Kanban Timeline
            const projects = this.plugin.settings.projects || [];
            projects.forEach(p => {
                if (p.name && !categoriesMap.has(p.name)) {
                    categoriesMap.set(p.name, `📁 Projeto: ${p.name}`);
                }
            });

            // Add common built-in categories if not present
            ['Work > Dev', 'Media > Video', 'Media > Social Media', 'Obsidian', 'Web Browser'].forEach(cat => {
                if (!categoriesMap.has(cat)) {
                    categoriesMap.set(cat, `⚡ ${cat}`);
                }
            });

            // Ensure current awFilter is retained as an option
            if (awFilter && !categoriesMap.has(awFilter)) {
                categoriesMap.set(awFilter, `🔍 ${awFilter}`);
            }

            // Update dropdown element options
            if (awDropdown && awDropdown.selectEl) {
                const curVal = awFilter || '';
                awDropdown.selectEl.empty();
                for (const [val, label] of categoriesMap.entries()) {
                    const opt = awDropdown.selectEl.createEl('option', { value: val, text: label });
                    if (val === curVal) opt.selected = true;
                }
                awDropdown.setValue(curVal);
            }
        };

        loadAwCategoriesIntoModal();

        const updateTypeVisibility = () => {
            if (type === 'boolean') {
                targetSetting.settingEl.style.display = 'none';
                unitSetting.settingEl.style.display = 'none';
                awSetting.settingEl.style.display = 'none';
            } else if (type === 'count') {
                targetSetting.settingEl.style.display = 'flex';
                targetSetting.setDesc('Quantidade que deseja atingir por dia (ex: 8)');
                unitSetting.settingEl.style.display = 'flex';
                unitSetting.setDesc('Nome da unidade (ex: copos, páginas, repetições)');
                awSetting.settingEl.style.display = 'none';
            } else if (type === 'time') {
                targetSetting.settingEl.style.display = 'flex';
                targetSetting.setDesc('Meta diária em minutos (ex: 30, 60, 120)');
                unitSetting.settingEl.style.display = 'flex';
                unitSetting.setDesc('Unidade de tempo (padrão: min)');
                if (!unit) unit = 'min';
                if (unitInputEl) unitInputEl.setValue(unit);
                awSetting.settingEl.style.display = this.plugin.settings.awConnected ? 'flex' : 'none';
            }
        };

        new obsidian.Setting(contentEl)
            .setName('Tipo de Medição')
            .setDesc('Como deseja registrar este hábito diariamente?')
            .addDropdown(d => {
                d.addOption('boolean', '✓ Simples (Feito / Não Feito)');
                d.addOption('count', '🔢 Contagem (Quantidade de vezes/copos/páginas)');
                d.addOption('time', '⏱ Tempo (Minutos ou Horas diárias)');
                d.setValue(type);
                d.onChange(v => {
                    type = v;
                    updateTypeVisibility();
                });
            });

        let activeDays = Array.isArray(habit?.activeDays) && habit.activeDays.length > 0
            ? habit.activeDays.slice()
            : [0, 1, 2, 3, 4, 5, 6];

        const daysSetting = new obsidian.Setting(contentEl)
            .setName('Dias Ativos / Frequência')
            .setDesc('Selecione os dias da semana em que este hábito deve ser realizado');

        const daysContainer = daysSetting.controlEl.createDiv('kt-habit-days-control');

        // Presets row
        const presetRow = daysContainer.createDiv('kt-habit-preset-row');
        const presets = [
            { label: 'Todos', days: [0, 1, 2, 3, 4, 5, 6] },
            { label: 'Seg–Sex', days: [1, 2, 3, 4, 5] },
            { label: 'Seg/Qua/Sex', days: [1, 3, 5] },
            { label: 'Ter/Qui/Sáb', days: [2, 4, 6] },
            { label: 'Fim de Semana', days: [6, 0] },
        ];

        const dayButtons = [];
        const DAYS_LIST = [
            { day: 1, label: 'Seg' },
            { day: 2, label: 'Ter' },
            { day: 3, label: 'Qua' },
            { day: 4, label: 'Qui' },
            { day: 5, label: 'Sex' },
            { day: 6, label: 'Sáb' },
            { day: 0, label: 'Dom' },
        ];

        const updateDayButtons = () => {
            dayButtons.forEach(({ btn, day }) => {
                btn.classList.toggle('is-active', activeDays.includes(day));
            });
        };

        presets.forEach(p => {
            const pBtn = presetRow.createEl('button', { cls: 'kt-habit-preset-btn', text: p.label });
            pBtn.onclick = (e) => {
                e.preventDefault();
                activeDays = p.days.slice();
                updateDayButtons();
            };
        });

        // Interactive pills row
        const pillsRow = daysContainer.createDiv('kt-habit-pills-row');
        DAYS_LIST.forEach(({ day, label }) => {
            const btn = pillsRow.createEl('button', {
                cls: `kt-habit-day-pill ${activeDays.includes(day) ? 'is-active' : ''}`,
                text: label
            });
            btn.onclick = (e) => {
                e.preventDefault();
                if (activeDays.includes(day)) {
                    if (activeDays.length > 1) {
                        activeDays = activeDays.filter(d => d !== day);
                    }
                } else {
                    activeDays.push(day);
                }
                updateDayButtons();
            };
            dayButtons.push({ btn, day });
        });

        new obsidian.Setting(contentEl)
            .setName('Cor do Hábito')
            .setDesc('Cor de destaque nos checks e gráficos')
            .addColorPicker(cp => {
                cp.setValue(color).onChange(v => color = v);
            });

        updateTypeVisibility(); // Set initial state

        const footer = contentEl.createDiv('kt-modal-footer');
        const leftGroup = footer.createDiv('kt-modal-footer-left');
        if (habit && this.onDelete) {
            const deleteBtn = leftGroup.createEl('button', { cls: 'mod-warning', text: 'Excluir Hábito' });
            deleteBtn.onclick = () => {
                this.close();
                this.onDelete();
            };
        }

        const rightGroup = footer.createDiv('kt-modal-footer-right');
        const cancelBtn = rightGroup.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: 'Salvar Hábito' });
        saveBtn.onclick = async () => {
            if (!name) {
                new obsidian.Notice('Por favor, informe o nome do hábito.');
                return;
            }
            this.close();
            const habitData = {
                id: habit ? habit.id : 'h-' + Date.now(),
                name,
                icon,
                type,
                target: type === 'boolean' ? 1 : target,
                unit: type === 'boolean' ? 'vez' : (unit || (type === 'time' ? 'min' : 'vezes')),
                color,
                activeDays,
                awFilter: type === 'time' ? awFilter : ''
            };
            if (this.onSave) await this.onSave(habitData);
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ================================================================
// HABIT QUICK VALUE MODAL (Registro Rápido de Tempo / Contagem)
// ================================================================

class HabitQuickValueModal extends obsidian.Modal {
    constructor(app, habit, date, currentValue, onSave) {
        super(app);
        this.app = app;
        this.habit = habit;
        this.date = date;
        this.currentValue = currentValue || 0;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl, habit, date } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper');
        this.modalEl.style.width = '380px';
        this.modalEl.style.maxWidth = '92vw';
        contentEl.addClass('kt-card-edit-modal');

        const dateStr = `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`;
        contentEl.createEl('h3', { text: `${habit.icon || '✨'} ${habit.name} (${dateStr})` });

        let val = Number(this.currentValue) || 0;

        if (habit.type === 'time') {
            const timeDesc = contentEl.createDiv('kt-quick-modal-desc');
            timeDesc.setText(`Meta: ${formatMinutesToHours(habit.target)} • Registrado: ${formatMinutesToHours(val) || '0m'}`);

            const quickBtns = contentEl.createDiv('kt-quick-btn-row');
            [
                { label: '+15m', add: 15 },
                { label: '+30m', add: 30 },
                { label: '+45m', add: 45 },
                { label: '+1h',  add: 60 },
                { label: `Meta (${habit.target}m)`, set: habit.target }
            ].forEach(b => {
                const btn = quickBtns.createEl('button', { cls: 'kt-quick-val-btn', text: b.label });
                btn.onclick = async () => {
                    if (b.add) val += b.add;
                    if (b.set !== undefined) val = b.set;
                    this.close();
                    if (this.onSave) await this.onSave(val);
                };
            });

            new obsidian.Setting(contentEl)
                .setName('Minutos Totais')
                .addText(t => {
                    t.setValue(String(val)).onChange(v => val = parseFloat(v) || 0);
                });
        } else if (habit.type === 'count') {
            const countDesc = contentEl.createDiv('kt-quick-modal-desc');
            countDesc.setText(`Meta: ${habit.target} ${habit.unit || ''} • Registrado: ${val}`);

            const quickBtns = contentEl.createDiv('kt-quick-btn-row');
            [
                { label: '+1', add: 1 },
                { label: '+2', add: 2 },
                { label: '+5', add: 5 },
                { label: `Meta (${habit.target})`, set: habit.target },
                { label: 'Zerar', set: 0 }
            ].forEach(b => {
                const btn = quickBtns.createEl('button', { cls: 'kt-quick-val-btn', text: b.label });
                btn.onclick = async () => {
                    if (b.add) val += b.add;
                    if (b.set !== undefined) val = b.set;
                    this.close();
                    if (this.onSave) await this.onSave(val);
                };
            });

            new obsidian.Setting(contentEl)
                .setName(`Quantidade (${habit.unit || 'unidades'})`)
                .addText(t => {
                    t.setValue(String(val)).onChange(v => val = parseFloat(v) || 0);
                });
        }

        const footer = contentEl.createDiv('kt-modal-footer');
        const leftGroup = footer.createDiv('kt-modal-footer-left');
        const resetBtn = leftGroup.createEl('button', { text: 'Zerar' });
        resetBtn.onclick = async () => {
            this.close();
            if (this.onSave) await this.onSave(0);
        };

        const rightGroup = footer.createDiv('kt-modal-footer-right');
        const cancelBtn = rightGroup.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: 'Salvar' });
        saveBtn.onclick = async () => {
            this.close();
            if (this.onSave) await this.onSave(val);
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class ColumnColorModal extends obsidian.Modal {
    constructor(app, plugin, columnName, currentColor, onSave) {
        super(app);
        this.plugin       = plugin;
        this.columnName   = columnName;
        this.currentColor = currentColor || '#06b6d4';
        this.onSave       = onSave;
    }

    onOpen() {
        const { contentEl, columnName } = this;
        contentEl.addClass('kt-modal');
        contentEl.createEl('h2', { text: `🎨 Cor da Coluna: ${columnName}` });

        let selectedColor = this.currentColor;

        const presets = [
            { name: 'Ciano',    hex: '#06b6d4' },
            { name: 'Azul',     hex: '#3b82f6' },
            { name: 'Índigo',   hex: '#6366f1' },
            { name: 'Roxo',     hex: '#a855f7' },
            { name: 'Rosa',     hex: '#ec4899' },
            { name: 'Vermelho', hex: '#ef4444' },
            { name: 'Laranja',  hex: '#f97316' },
            { name: 'Amarelo',  hex: '#eab308' },
            { name: 'Lima',     hex: '#84cc16' },
            { name: 'Verde',    hex: '#22c55e' },
            { name: 'Esmeralda',hex: '#10b981' },
            { name: 'Ardósia',  hex: '#64748b' },
        ];

        const previewContainer = contentEl.createDiv('kt-color-preview-box');
        const previewDot = previewContainer.createSpan('kt-color-preview-dot');
        previewDot.style.backgroundColor = selectedColor;
        const previewText = previewContainer.createSpan({ text: `Cards da coluna "${columnName}" herdarão esta cor` });

        // Palette presets
        const paletteEl = contentEl.createDiv('kt-color-palette');
        let colorPickerInput;

        presets.forEach(p => {
            const circle = paletteEl.createDiv('kt-color-swatch');
            circle.style.backgroundColor = p.hex;
            circle.title = `${p.name} (${p.hex})`;
            if (p.hex.toLowerCase() === selectedColor.toLowerCase()) {
                circle.addClass('is-selected');
            }
            circle.onclick = () => {
                selectedColor = p.hex;
                paletteEl.querySelectorAll('.kt-color-swatch').forEach(c => c.classList.remove('is-selected'));
                circle.addClass('is-selected');
                previewDot.style.backgroundColor = selectedColor;
                if (colorPickerInput) colorPickerInput.setValue(selectedColor);
            };
        });

        // Custom color input
        new obsidian.Setting(contentEl)
            .setName('Cor Personalizada')
            .setDesc('Escolha qualquer tom')
            .addColorPicker(cp => {
                colorPickerInput = cp;
                cp.setValue(selectedColor).onChange(v => {
                    selectedColor = v;
                    previewDot.style.backgroundColor = v;
                });
            });

        new obsidian.Setting(contentEl)
            .addButton(b => b.setButtonText('💾 Salvar Cor').setCta().onClick(async () => {
                if (!this.plugin.settings.columnColors) {
                    this.plugin.settings.columnColors = {};
                }
                this.plugin.settings.columnColors[columnName] = selectedColor;
                await this.plugin.saveSettings();

                // Persist into Kanban.md header if file exists
                const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
                if (file) {
                    const content = await this.app.vault.read(file);
                    const updated = new KanbanParser().updateColumnColorInFile(content, columnName, selectedColor);
                    if (updated !== content) {
                        await this.app.vault.modify(file, updated);
                    }
                }

                new obsidian.Notice(`🎨 Cor de "${columnName}" atualizada para ${selectedColor}`);
                if (this.onSave) this.onSave();
                this.close();
            }))
            .addButton(b => b.setButtonText('Cancelar').onClick(() => this.close()));
    }

    onClose() { this.contentEl.empty(); }
}

class CustomEventModal extends obsidian.Modal {
    constructor(app, date, defaultHour, defaultMin, onSave) {
        super(app);
        this.date        = date;
        this.defaultHour = defaultHour;
        this.defaultMin  = defaultMin;
        this.onSave      = onSave;
    }

    onOpen() {
        const { contentEl, date } = this;
        contentEl.addClass('kt-modal');
        contentEl.createEl('h2', { text: `➕ Novo Bloco / Evento (${formatDate(date)})` });

        let titleVal = '☕ Pausa';
        let typeVal  = 'break';
        const startMin = this.defaultHour * 60 + this.defaultMin;
        let startVal = minutesToTime(startMin);
        let endVal   = minutesToTime(Math.min(23 * 60 + 59, startMin + 60));

        let repeatRule = 'none';
        let repeatWeeks = 4;
        let customDays = [date.getDay()];

        new obsidian.Setting(contentEl)
            .setName('Nome do Bloco')
            .addText(t => {
                t.setValue(titleVal).setPlaceholder('Ex: Almoço, Reunião com Cliente, Academia...');
                t.onChange(v => titleVal = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Tipo de Visual')
            .addDropdown(d => {
                d.addOption('break', '🍽️ Refeição / ☕ Pausa / Descanso');
                d.addOption('meeting', '👥 Reunião / Alinhamento');
                d.addOption('focus', '🎯 Foco / Estudo / Trabalho');
                d.addOption('custom', '📝 Geral / Outro');
                d.setValue(typeVal);
                d.onChange(v => typeVal = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Horário Início')
            .addText(t => { t.setValue(startVal); t.onChange(v => startVal = v); });

        new obsidian.Setting(contentEl)
            .setName('Horário Fim')
            .addText(t => { t.setValue(endVal); t.onChange(v => endVal = v); });

        // Recurrence Setting (Google Calendar style)
        const dowNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        const todayDowName = dowNames[date.getDay()];

        const repeatSetting = new obsidian.Setting(contentEl)
            .setName('Repetição')
            .setDesc('Preencher automaticamente em múltiplos dias');

        const customDaysWrap = contentEl.createDiv('kt-custom-days-wrap');
        customDaysWrap.style.display = 'none';
        customDaysWrap.style.margin = '4px 0 14px 0';
        customDaysWrap.style.padding = '8px 12px';
        customDaysWrap.style.background = 'var(--background-secondary)';
        customDaysWrap.style.borderRadius = '6px';

        const customDaysTitle = customDaysWrap.createEl('div', { text: 'Repetir em quais dias da semana:', cls: 'kt-custom-days-label' });
        customDaysTitle.style.fontSize = '12px';
        customDaysTitle.style.marginBottom = '6px';
        customDaysTitle.style.color = 'var(--text-muted)';

        const daysBtnRow = customDaysWrap.createDiv('kt-custom-days-row');
        daysBtnRow.style.display = 'flex';
        daysBtnRow.style.gap = '6px';

        const dayAbbrs = [
            { dow: 1, label: 'Seg' },
            { dow: 2, label: 'Ter' },
            { dow: 3, label: 'Qua' },
            { dow: 4, label: 'Qui' },
            { dow: 5, label: 'Sex' },
            { dow: 6, label: 'Sáb' },
            { dow: 0, label: 'Dom' },
        ];

        dayAbbrs.forEach(dInfo => {
            const b = daysBtnRow.createEl('button', {
                text: dInfo.label,
                cls: `kt-day-select-btn ${customDays.includes(dInfo.dow) ? 'is-active' : ''}`
            });
            b.style.padding = '4px 8px';
            b.style.fontSize = '11.5px';
            b.onclick = (e) => {
                e.preventDefault();
                if (customDays.includes(dInfo.dow)) {
                    customDays = customDays.filter(x => x !== dInfo.dow);
                    b.classList.remove('is-active');
                } else {
                    customDays.push(dInfo.dow);
                    b.classList.add('is-active');
                }
            };
        });

        // Horizon setting
        const horizonSetting = new obsidian.Setting(contentEl)
            .setName('Duração da Série')
            .setDesc('Quantas semanas preencher automaticamente')
            .addDropdown(d => {
                d.addOption('4', '4 semanas (~1 mês)');
                d.addOption('8', '8 semanas (~2 meses)');
                d.addOption('12', '12 semanas (~3 meses)');
                d.addOption('26', '26 semanas (~6 meses)');
                d.setValue('4');
                d.onChange(v => repeatWeeks = parseInt(v, 10) || 4);
            });
        horizonSetting.settingEl.style.display = 'none';

        repeatSetting.addDropdown(d => {
            d.addOption('none', 'Não se repete (Apenas hoje)');
            d.addOption('daily', 'Todos os dias (Seg a Dom)');
            d.addOption('weekdays', 'Dias úteis (Segunda a Sexta)');
            d.addOption('weekly', `Semanalmente (Toda ${todayDowName})`);
            d.addOption('custom', 'Personalizado (Escolher dias da semana)');
            d.setValue(repeatRule);
            d.onChange(v => {
                repeatRule = v;
                if (v === 'none') {
                    customDaysWrap.style.display = 'none';
                    horizonSetting.settingEl.style.display = 'none';
                } else if (v === 'custom') {
                    customDaysWrap.style.display = 'block';
                    horizonSetting.settingEl.style.display = 'flex';
                } else {
                    customDaysWrap.style.display = 'none';
                    horizonSetting.settingEl.style.display = 'flex';
                }
            });
        });

        new obsidian.Setting(contentEl)
            .addButton(b => b.setButtonText('💾 Criar Bloco').setCta().onClick(() => {
                if (!titleVal.trim()) { new obsidian.Notice('⚠️ Digite um nome para o bloco'); return; }
                if (!/^\d{2}:\d{2}$/.test(startVal) || !/^\d{2}:\d{2}$/.test(endVal)) {
                    new obsidian.Notice('⚠️ Horário inválido. Use HH:mm');
                    return;
                }
                this.onSave(titleVal.trim(), startVal, endVal, typeVal, repeatRule, customDays, repeatWeeks);
                this.close();
            }))
            .addButton(b => b.setButtonText('Cancelar').onClick(() => this.close()));
    }

    onClose() { this.contentEl.empty(); }
}

// ================================================================
// QUICK CREATE TASK MODAL (Clique no espaço vazio do Timeblocking)
// ================================================================

class QuickCreateTaskModal extends obsidian.Modal {
    constructor(app, plugin, day, hour, min, columns, untimedCards, onSaveNew, onAssignExisting) {
        super(app);
        this.app            = app;
        this.plugin         = plugin;
        this.day            = day;
        this.hour           = hour;
        this.min            = min;
        this.columns        = columns && columns.length > 0 ? columns : ['Todo'];
        this.untimedCards   = untimedCards || [];
        this.onSaveNew      = onSaveNew;
        this.onAssignExisting = onAssignExisting;
    }

    onOpen() {
        const { contentEl, day, hour, min } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper', 'kt-quick-create-modal');
        this.modalEl.style.width = '520px';
        this.modalEl.style.maxWidth = '94vw';
        contentEl.addClass('kt-card-edit-modal');

        const pad = n => String(n).padStart(2, '0');
        const startMin = hour * 60 + min;
        const endMin   = Math.min(23 * 60 + 59, startMin + 60);
        let startVal   = minutesToTime(startMin);
        let endVal     = minutesToTime(endMin);
        let dateVal    = formatDate(day);
        let selectedCol = this.columns[0];

        const daysOfWeek = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        const dayName = daysOfWeek[day.getDay()];

        contentEl.createEl('h2', { text: `Nova Tarefa • ${dayName} (${dateVal})` });

        // 1. Title Input Section
        const contentSection = contentEl.createDiv('kt-edit-content-section');
        contentSection.createEl('label', { cls: 'kt-edit-label', text: 'Nome da Tarefa:' });

        const inputEl = contentSection.createEl('input', {
            type: 'text',
            cls: 'kt-quick-create-input',
            attr: {
                placeholder: 'Escreva a tarefa, #projeto ou tags...',
                autofocus: 'autofocus'
            }
        });
        inputEl.style.width = '100%';
        inputEl.style.padding = '8px 12px';
        inputEl.style.fontSize = '14px';
        inputEl.style.borderRadius = '6px';
        inputEl.style.border = '1px solid var(--background-modifier-border)';
        inputEl.style.background = 'var(--background-primary)';
        inputEl.style.color = 'var(--text-normal)';

        // Autocomplete for project tags
        new CardTextareaSuggester(this.app, inputEl, () => (this.plugin.settings.projects || []).map(p => p.tag).filter(Boolean));

        setTimeout(() => {
            inputEl.focus();
        }, 30);

        // 2. Untimed Cards Quick Selector (if there are existing cards on this day without time)
        let selectedExistingCard = null;
        if (this.untimedCards.length > 0) {
            const existingWrap = contentEl.createDiv('kt-untimed-quick-select-wrap');
            existingWrap.style.marginTop = '10px';
            existingWrap.style.padding = '8px 12px';
            existingWrap.style.background = 'var(--background-secondary)';
            existingWrap.style.borderRadius = '6px';

            new obsidian.Setting(existingWrap)
                .setName('Ou vincular card existente:')
                .addDropdown(d => {
                    d.addOption('__new__', '-- Criar nova tarefa digitada acima --');
                    this.untimedCards.forEach(c => {
                        d.addOption(String(c.lineIndex), c.title);
                    });
                    d.setValue('__new__');
                    d.onChange(v => {
                        if (v === '__new__') {
                            selectedExistingCard = null;
                        } else {
                            selectedExistingCard = this.untimedCards.find(c => String(c.lineIndex) === v);
                            if (selectedExistingCard) {
                                inputEl.value = selectedExistingCard.title;
                            }
                        }
                    });
                });
        }

        // 3. Kanban Column setting
        const metaSection = contentEl.createDiv('kt-edit-meta-section');
        metaSection.style.marginTop = '12px';

        new obsidian.Setting(metaSection)
            .setName('Coluna do Kanban')
            .addDropdown(d => {
                this.columns.forEach(c => d.addOption(c, c));
                d.setValue(selectedCol);
                d.onChange(v => selectedCol = v);
            });

        // 4. Time Setting
        const timeSetting = new obsidian.Setting(metaSection)
            .setName('Horário no Timeblocking')
            .setDesc('Início e término agendado');

        timeSetting.addText(t => {
            t.setPlaceholder('HH:MM').setValue(startVal).onChange(v => startVal = v.trim());
            t.inputEl.style.width = '100px';
        });

        timeSetting.addText(t => {
            t.setPlaceholder('HH:MM').setValue(endVal).onChange(v => endVal = v.trim());
            t.inputEl.style.width = '100px';
        });

        // 5. Footer buttons
        const footer = contentEl.createDiv('kt-modal-footer');
        footer.style.marginTop = '16px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '8px';

        const cancelBtn = footer.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = footer.createEl('button', { cls: 'mod-cta', text: 'Criar Tarefa' });

        const submit = () => {
            const trimmed = inputEl.value.trim();
            if (!trimmed && !selectedExistingCard) {
                new obsidian.Notice('⚠️ Digite o nome da tarefa');
                return;
            }
            if (!/^\d{2}:\d{2}$/.test(startVal) || !/^\d{2}:\d{2}$/.test(endVal)) {
                new obsidian.Notice('⚠️ Horário inválido. Use HH:mm');
                return;
            }
            this.close();

            if (selectedExistingCard && this.onAssignExisting) {
                this.onAssignExisting(selectedExistingCard, startVal, endVal);
            } else if (this.onSaveNew) {
                this.onSaveNew(trimmed, selectedCol, startVal, endVal);
            }
        };

        saveBtn.onclick = submit;
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ================================================================
// FINANCE CURRENCY PARSER & UTILITIES
// ================================================================

function parseFinanceCurrencyInput(raw) {
    if (typeof raw === 'number') return isNaN(raw) ? 0 : Math.round(raw * 100) / 100;
    if (!raw) return 0;
    
    let str = String(raw).trim();
    if (!str) return 0;

    // If string contains parenthetical text/comments e.g. "325 ( 63 - Julia / 61 + 61 Ana e tuts)", remove them first
    str = str.replace(/\(.*?\)/g, '').trim();

    // Strip currency symbols (R$, $, €, £), spaces, and non-breaking spaces
    str = str.replace(/R\$|\$|€|£|\s|\u00A0/gi, '');
    if (!str) return 0;

    // Distinguish Brazilian (7.954,54) vs US (7,954.54) vs Plain numbers (7954,54 or 7954.54)
    if (str.includes(',') && str.includes('.')) {
        if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
            // "7.954,54" -> Brazilian format
            str = str.replace(/\./g, '').replace(',', '.');
        } else {
            // "7,954.54" -> US format
            str = str.replace(/,/g, '');
        }
    } else if (str.includes(',')) {
        // "7954,54" -> Comma as decimal
        str = str.replace(',', '.');
    } else if (str.includes('.')) {
        // Check for multiple dots e.g. "1.000.000"
        const dotCount = (str.match(/\./g) || []).length;
        if (dotCount > 1) {
            str = str.replace(/\./g, '');
        }
    }

    // Extract leading number
    const numMatch = str.match(/-?\d+(?:\.\d+)?/);
    if (!numMatch) return 0;

    const val = parseFloat(numMatch[0]);
    return isNaN(val) ? 0 : Math.round(val * 100) / 100;
}

function getFinanceMonthName(m) {
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const idx = parseInt(m, 10) - 1;
    return (idx >= 0 && idx < monthNames.length) ? monthNames[idx] : `Mês ${m}`;
}

// ================================================================
// FINANCE MODALS (Lançamentos, Parcelas, Datas, Cobrança/Split, Orçamento Planejado, Saldo e Importação)
// ================================================================

class FinanceInstallmentPopover {
    constructor(anchorEl, currentInstallment, onSave) {
        this.anchorEl           = anchorEl;
        this.currentInstallment = currentInstallment || '1/1';
        this.onSave             = onSave;
        this.popoverEl          = null;
        this.backdropEl         = null;
    }

    open() {
        this.render();
    }

    close() {
        if (this.popoverEl) {
            this.popoverEl.remove();
            this.popoverEl = null;
        }
        if (this.backdropEl) {
            this.backdropEl.remove();
            this.backdropEl = null;
        }
    }

    render() {
        this.close();

        // 1. Transparent Backdrop
        this.backdropEl = document.body.createDiv('kt-gcal-backdrop');
        this.backdropEl.onclick = (e) => {
            e.stopPropagation();
            this.close();
        };

        // 2. Floating Popover Container
        const pop = document.body.createDiv('kt-gcal-popover kt-installment-popover');
        this.popoverEl = pop;
        pop.onclick = (e) => e.stopPropagation();

        const rect = this.anchorEl.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.left;

        if (left + 220 > window.innerWidth) {
            left = window.innerWidth - 230;
        }
        if (top + 150 > window.innerHeight) {
            top = Math.max(10, rect.top - 156);
        }
        pop.style.top = `${Math.max(10, top)}px`;
        pop.style.left = `${Math.max(10, left)}px`;

        const parts = this.currentInstallment.replace(/[()]/g, '').split('/');
        let cur = parseInt(parts[0], 10) || 1;
        let tot = parseInt(parts[1], 10) || 1;

        // Header: Title
        const hdr = pop.createDiv('kt-gcal-hdr');
        hdr.createSpan({ cls: 'kt-gcal-title', text: '📦 Ajustar Parcela' });

        // Stepper Bar
        const stepRow = pop.createDiv('kt-inst-step-row');
        const prevBtn = stepRow.createEl('button', { cls: 'kt-gcal-nav-btn', text: '‹' });
        prevBtn.title = 'Parcela anterior';
        prevBtn.disabled = cur <= 1;

        const curDisplay = stepRow.createSpan({ cls: 'kt-inst-display', text: `(${cur}/${tot})` });

        const nextBtn = stepRow.createEl('button', { cls: 'kt-gcal-nav-btn', text: '›' });
        nextBtn.title = 'Próxima parcela';

        prevBtn.onclick = (e) => {
            e.stopPropagation();
            if (cur > 1) {
                cur--;
                this.close();
                this.onSave(`${cur}/${tot}`);
            }
        };

        nextBtn.onclick = (e) => {
            e.stopPropagation();
            cur++;
            if (cur > tot) tot = cur;
            this.close();
            this.onSave(`${cur}/${tot}`);
        };

        // Custom Inputs Row: [ cur ] de [ tot ]
        const inputRow = pop.createDiv('kt-inst-input-row');
        inputRow.createSpan({ text: 'Parcela', cls: 'kt-inst-lbl' });

        const curIn = inputRow.createEl('input', { type: 'number', attr: { min: '1', value: String(cur) } });
        curIn.style.width = '44px';
        curIn.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v > 0) {
                cur = v;
                curDisplay.setText(`(${cur}/${tot})`);
            }
        };

        inputRow.createSpan({ text: 'de', cls: 'kt-inst-lbl' });

        const totIn = inputRow.createEl('input', { type: 'number', attr: { min: '1', value: String(tot) } });
        totIn.style.width = '44px';
        totIn.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v > 0) {
                tot = v;
                curDisplay.setText(`(${cur}/${tot})`);
            }
        };

        // Footer: À Vista & Salvar
        const ftr = pop.createDiv('kt-gcal-ftr');
        const removeLink = ftr.createEl('button', { cls: 'kt-gcal-link-btn kt-gcal-fixo-link', text: 'À vista' });
        removeLink.onclick = (e) => {
            e.stopPropagation();
            this.close();
            this.onSave('');
        };

        const saveBtn = ftr.createEl('button', { cls: 'kt-gcal-link-btn', text: 'Salvar' });
        saveBtn.onclick = (e) => {
            e.stopPropagation();
            this.close();
            this.onSave(`${cur}/${tot}`);
        };
    }
}

const FinanceInstallmentModal = FinanceInstallmentPopover;

class FinanceDatePickerPopover {
    constructor(anchorEl, currentDate, year, month, onSave) {
        this.anchorEl     = anchorEl;
        this.currentDate  = currentDate || '';
        this.viewYear     = year;
        this.viewMonth    = month;
        this.selectedDate = currentDate || '';
        this.onSave       = onSave;
        this.popoverEl    = null;
        this.backdropEl   = null;
    }

    open() {
        this.render();
    }

    close() {
        if (this.popoverEl) {
            this.popoverEl.remove();
            this.popoverEl = null;
        }
        if (this.backdropEl) {
            this.backdropEl.remove();
            this.backdropEl = null;
        }
    }

    render() {
        this.close();

        // 1. Transparent Backdrop to catch outside clicks
        this.backdropEl = document.body.createDiv('kt-gcal-backdrop');
        this.backdropEl.onclick = (e) => {
            e.stopPropagation();
            this.close();
        };

        // 2. Floating Popover Container
        const pop = document.body.createDiv('kt-gcal-popover');
        this.popoverEl = pop;
        pop.onclick = (e) => e.stopPropagation();

        // Position popover relative to anchorEl
        const rect = this.anchorEl.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.left;

        // Ensure within screen bounds
        if (left + 260 > window.innerWidth) {
            left = window.innerWidth - 270;
        }
        if (top + 290 > window.innerHeight) {
            top = Math.max(10, rect.top - 296);
        }
        pop.style.top = `${Math.max(10, top)}px`;
        pop.style.left = `${Math.max(10, left)}px`;

        const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        const monthTitle = `${monthNames[this.viewMonth - 1]} de ${this.viewYear}`;

        // Header: Month/Year & Navigation Arrows
        const hdr = pop.createDiv('kt-gcal-hdr');
        hdr.createSpan({ cls: 'kt-gcal-title', text: monthTitle });

        const navWrap = hdr.createDiv('kt-gcal-nav');
        const prevBtn = navWrap.createEl('button', { cls: 'kt-gcal-nav-btn', text: '‹' });
        prevBtn.title = 'Mês anterior';
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.viewMonth === 1) {
                this.viewMonth = 12;
                this.viewYear--;
            } else {
                this.viewMonth--;
            }
            this.render();
        };

        const nextBtn = navWrap.createEl('button', { cls: 'kt-gcal-nav-btn', text: '›' });
        nextBtn.title = 'Próximo mês';
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.viewMonth === 12) {
                this.viewMonth = 1;
                this.viewYear++;
            } else {
                this.viewMonth++;
            }
            this.render();
        };

        // Weekday header row: D S T Q Q S S
        const daysHdr = pop.createDiv('kt-gcal-weekdays');
        ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach(w => {
            daysHdr.createSpan({ cls: 'kt-gcal-weekday', text: w });
        });

        // Days Grid (with leading and trailing days from prev/next month)
        const grid = pop.createDiv('kt-gcal-grid');
        const firstDayOfWeek = new Date(this.viewYear, this.viewMonth - 1, 1).getDay();
        const daysInMonth = new Date(this.viewYear, this.viewMonth, 0).getDate();
        const daysInPrevMonth = new Date(this.viewYear, this.viewMonth - 1, 0).getDate();

        // Selected day check
        let selDay = null, selMon = null, selYr = null;
        if (this.selectedDate && this.selectedDate.includes('-')) {
            const parts = this.selectedDate.split('-');
            selYr = parseInt(parts[0], 10);
            selMon = parseInt(parts[1], 10);
            selDay = parseInt(parts[2], 10);
        }

        const now = new Date();
        const todayYr = now.getFullYear();
        const todayMon = now.getMonth() + 1;
        const todayDay = now.getDate();

        // Prev month muted days
        for (let i = firstDayOfWeek - 1; i >= 0; i--) {
            const pDay = daysInPrevMonth - i;
            const slot = grid.createDiv('kt-gcal-day kt-gcal-day-muted');
            slot.setText(String(pDay));
            slot.onclick = (e) => {
                e.stopPropagation();
                let m = this.viewMonth - 1;
                let y = this.viewYear;
                if (m === 0) { m = 12; y--; }
                const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(pDay).padStart(2,'0')}`;
                this.close();
                this.onSave(dateStr, false);
            };
        }

        // Current month days
        for (let d = 1; d <= daysInMonth; d++) {
            const isSelected = (selDay === d && selMon === this.viewMonth && selYr === this.viewYear);
            const isToday = (todayDay === d && todayMon === this.viewMonth && todayYr === this.viewYear);
            const slot = grid.createDiv(`kt-gcal-day ${isSelected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`);
            slot.setText(String(d));

            slot.onclick = (e) => {
                e.stopPropagation();
                const dateStr = `${this.viewYear}-${String(this.viewMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                this.close();
                this.onSave(dateStr, false);
            };
        }

        // Next month muted days to fill 5 or 6 rows (multiples of 7)
        const totalSlots = firstDayOfWeek + daysInMonth;
        const remaining = (totalSlots % 7 === 0) ? 0 : (7 - (totalSlots % 7));
        for (let n = 1; n <= remaining; n++) {
            const slot = grid.createDiv('kt-gcal-day kt-gcal-day-muted');
            slot.setText(String(n));
            slot.onclick = (e) => {
                e.stopPropagation();
                let m = this.viewMonth + 1;
                let y = this.viewYear;
                if (m === 13) { m = 1; y++; }
                const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(n).padStart(2,'0')}`;
                this.close();
                this.onSave(dateStr, false);
            };
        }

        // Footer: Hoje & Gasto Fixo
        const ftr = pop.createDiv('kt-gcal-ftr');
        const hojeLink = ftr.createEl('button', { cls: 'kt-gcal-link-btn', text: 'Hoje' });
        hojeLink.onclick = (e) => {
            e.stopPropagation();
            const dateStr = `${todayYr}-${String(todayMon).padStart(2,'0')}-${String(todayDay).padStart(2,'0')}`;
            this.close();
            this.onSave(dateStr, false);
        };

        const fixoLink = ftr.createEl('button', { cls: 'kt-gcal-link-btn kt-gcal-fixo-link', text: 'Gasto Fixo' });
        fixoLink.onclick = (e) => {
            e.stopPropagation();
            const dateStr = `${this.viewYear}-${String(this.viewMonth).padStart(2,'0')}-01`;
            this.close();
            this.onSave(dateStr, true);
        };
    }
}

// Backward compatibility alias
const FinanceDatePickerModal = FinanceDatePickerPopover;

class FinanceSplitModal extends obsidian.Modal {
    constructor(app, plugin, item, curr, onSave) {
        super(app);
        this.app    = app;
        this.plugin = plugin;
        this.item   = item;
        this.curr   = curr || 'R$';
        this.onSave = onSave;

        // Initialize structured split data
        const initialSplit = item.splitData || {
            isSplit: !!item.isSplit,
            participants: [],
            totalToCollect: 0
        };

        // If participants is empty but item had toCollect string, migrate it
        if (initialSplit.participants.length === 0 && item.toCollect) {
            const parts = item.toCollect.split(/,|\be\b|\+/i);
            parts.forEach(p => {
                const clean = p.trim();
                if (!clean) return;
                const matchVal = clean.match(/(\d+[\.,]?\d*)/);
                const num = matchVal ? parseFloat(matchVal[1].replace(',', '.')) : 0;
                const name = clean.replace(matchVal ? matchVal[0] : '', '').trim() || 'Pessoa';
                initialSplit.participants.push({
                    name: name.charAt(0).toUpperCase() + name.slice(1),
                    amount: num,
                    settled: false
                });
            });
        }

        this.splitData = JSON.parse(JSON.stringify(initialSplit));
        if (!this.splitData.participants) this.splitData.participants = [];
    }

    onOpen() {
        const { contentEl, item, curr } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper', 'kt-fin-modal-wrapper');
        this.modalEl.style.width = '520px';
        this.modalEl.style.maxWidth = '94vw';
        contentEl.empty();
        contentEl.addClass('kt-card-edit-modal');

        contentEl.createEl('h2', { text: `👥 Cobrança & Divisão de Conta` });

        const infoRow = contentEl.createDiv('kt-fin-split-info-row');
        infoRow.style.padding = '10px 14px';
        infoRow.style.background = 'var(--background-secondary)';
        infoRow.style.borderRadius = '8px';
        infoRow.style.margin = '10px 0 16px 0';
        infoRow.style.display = 'flex';
        infoRow.style.justifyContent = 'space-between';
        infoRow.style.alignItems = 'center';

        infoRow.createDiv({ text: `Despesa: ${item.description}`, cls: 'kt-fin-split-item-desc' });
        const valSpan = infoRow.createSpan({ text: `Total: ${formatCurrency(item.value, curr)}`, cls: 'kt-fin-split-item-val' });
        valSpan.style.fontWeight = '700';

        // Equal Division Helper
        const helperBox = contentEl.createDiv('kt-fin-equal-split-box');
        helperBox.style.padding = '8px 12px';
        helperBox.style.background = 'var(--background-primary)';
        helperBox.style.border = '1px dashed var(--background-modifier-border)';
        helperBox.style.borderRadius = '8px';
        helperBox.style.marginBottom = '14px';
        helperBox.style.display = 'flex';
        helperBox.style.alignItems = 'center';
        helperBox.style.justifyContent = 'space-between';
        helperBox.style.gap = '10px';

        helperBox.createSpan({ text: 'Divisão igualitária rápida:', cls: 'kt-fin-equal-lbl' });
        
        const helperRight = helperBox.createDiv();
        helperRight.style.display = 'flex';
        helperRight.style.gap = '6px';
        helperRight.style.alignItems = 'center';

        const countInput = helperRight.createEl('input', {
            type: 'number',
            attr: { min: '2', max: '20', value: '2' }
        });
        countInput.style.width = '55px';
        countInput.style.textAlign = 'center';

        const applyEqualBtn = helperRight.createEl('button', { text: 'Dividir', cls: 'kt-btn-sm' });
        applyEqualBtn.onclick = () => {
            const count = parseInt(countInput.value, 10);
            if (isNaN(count) || count <= 1) {
                new obsidian.Notice('⚠️ Digite 2 ou mais pessoas.');
                return;
            }
            const eachShare = Math.round((item.value / count) * 100) / 100;
            this.splitData.participants = [];
            for (let i = 1; i < count; i++) {
                this.splitData.participants.push({
                    name: `Pessoa ${i}`,
                    amount: eachShare,
                    settled: false
                });
            }
            this.splitData.isSplit = true;
            this.onOpen();
        };

        // Participants List
        contentEl.createEl('h4', { text: 'Pessoas a Cobrar', cls: 'kt-fin-section-subtitle' });
        const listWrap = contentEl.createDiv('kt-fin-participants-list');
        listWrap.style.display = 'flex';
        listWrap.style.flexDirection = 'column';
        listWrap.style.gap = '8px';
        listWrap.style.maxHeight = '36vh';
        listWrap.style.overflowY = 'auto';

        const renderParticipants = () => {
            listWrap.empty();
            if (this.splitData.participants.length === 0) {
                const emptyMsg = listWrap.createDiv({ text: 'Nenhuma pessoa adicionada para cobrança.' });
                emptyMsg.style.color = 'var(--text-muted)';
                emptyMsg.style.fontStyle = 'italic';
                emptyMsg.style.padding = '8px 0';
                return;
            }

            this.splitData.participants.forEach((p, idx) => {
                const row = listWrap.createDiv('kt-fin-participant-row');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '8px';
                row.style.background = 'var(--background-secondary)';
                row.style.padding = '6px 10px';
                row.style.borderRadius = '6px';

                // Name Input
                const nameInput = row.createEl('input', {
                    type: 'text',
                    attr: {
                        placeholder: 'Nome da pessoa',
                        autocomplete: 'off',
                        spellcheck: 'false'
                    },
                    value: p.name || ''
                });
                nameInput.style.flex = '1';
                nameInput.addEventListener('input', (e) => {
                    p.name = e.target.value;
                });
                nameInput.addEventListener('change', (e) => {
                    if (e.target.value) {
                        const cap = e.target.value.trim().charAt(0).toUpperCase() + e.target.value.trim().slice(1);
                        p.name = cap;
                        e.target.value = cap;
                    }
                });

                // Amount Input
                const amtInput = row.createEl('input', {
                    type: 'text',
                    attr: { placeholder: 'Valor (R$)' },
                    value: p.amount != null ? String(p.amount) : ''
                });
                amtInput.style.width = '90px';
                amtInput.style.fontWeight = '700';
                amtInput.addEventListener('input', (e) => {
                    p.amount = parseFinanceCurrencyInput(e.target.value);
                    updateSummary();
                });

                // Settled Checkbox
                const checkWrap = row.createDiv('kt-fin-settled-check-wrap');
                checkWrap.style.display = 'flex';
                checkWrap.style.alignItems = 'center';
                checkWrap.style.gap = '4px';
                checkWrap.title = 'Marcar se a pessoa já pagou/transferiu';

                const cb = checkWrap.createEl('input', { type: 'checkbox' });
                cb.checked = !!p.settled;
                cb.addEventListener('change', (e) => {
                    p.settled = e.target.checked;
                    updateSummary();
                });
                checkWrap.createSpan({ text: 'Pago', cls: 'kt-fin-cb-label' });

                // Delete Button
                const delBtn = row.createEl('button', { cls: 'kt-fin-row-btn mod-warning', text: '✕' });
                delBtn.onclick = () => {
                    this.splitData.participants.splice(idx, 1);
                    renderParticipants();
                    updateSummary();
                };
            });
        };

        renderParticipants();

        // Add Person Button
        const addPersonBtn = contentEl.createEl('button', {
            text: '＋ Adicionar Pessoa',
            cls: 'kt-btn-add-person'
        });
        addPersonBtn.style.marginTop = '10px';
        addPersonBtn.onclick = () => {
            this.splitData.participants.push({
                name: '',
                amount: 0,
                settled: false
            });
            renderParticipants();
            updateSummary();
        };

        // Summary Bar
        const summaryBar = contentEl.createDiv('kt-fin-split-summary-bar');
        summaryBar.style.marginTop = '16px';
        summaryBar.style.padding = '10px 14px';
        summaryBar.style.borderRadius = '8px';
        summaryBar.style.background = 'var(--background-secondary)';
        summaryBar.style.display = 'flex';
        summaryBar.style.justifyContent = 'space-between';
        summaryBar.style.alignItems = 'center';

        const updateSummary = () => {
            const totalOthers = this.splitData.participants.reduce((acc, p) => acc + (p.amount || 0), 0);
            const pendingCollect = this.splitData.participants.filter(p => !p.settled).reduce((acc, p) => acc + (p.amount || 0), 0);
            const myShare = Math.max(0, item.value - totalOthers);

            summaryBar.empty();
            const left = summaryBar.createDiv();
            left.createDiv({ text: `Total a cobrar: ${formatCurrency(pendingCollect, curr)}`, cls: pendingCollect > 0 ? 'kt-diff-neg' : 'kt-diff-pos' });
            left.createDiv({ text: `Sua parte: ${formatCurrency(myShare, curr)}`, cls: 'kt-fin-sub-meta' });

            const isAllSettled = this.splitData.participants.length > 0 && pendingCollect === 0;
            if (isAllSettled) {
                summaryBar.createSpan({ text: '✓ Cobrança 100% quitada', cls: 'kt-diff-pos' });
            }
        };

        updateSummary();

        // Footer buttons
        const footer = contentEl.createDiv('kt-modal-footer');
        footer.style.marginTop = '18px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';

        const removeBtn = footer.createEl('button', { cls: 'mod-warning', text: 'Remover Cobrança' });
        removeBtn.onclick = () => {
            this.close();
            this.onSave(null);
        };

        const rightGroup = footer.createDiv('kt-modal-footer-right');
        rightGroup.style.display = 'flex';
        rightGroup.style.gap = '8px';

        const cancelBtn = rightGroup.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: 'Salvar Cobrança' });
        saveBtn.onclick = () => {
            const validParticipants = this.splitData.participants.filter(p => p.name.trim() || p.amount > 0);
            if (validParticipants.length === 0) {
                this.close();
                this.onSave(null);
                return;
            }

            const totalToCollect = validParticipants.filter(p => !p.settled).reduce((acc, p) => acc + (p.amount || 0), 0);
            const cleanSplitData = {
                isSplit: true,
                participants: validParticipants,
                totalToCollect
            };

            this.close();
            this.onSave(cleanSplitData);
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class FinanceEntryModal extends obsidian.Modal {
    constructor(app, plugin, mode, item, year, month, categories, onSave, onDelete) {
        super(app);
        this.app        = app;
        this.plugin     = plugin;
        this.mode       = mode || 'expense';
        this.item       = item || null;
        this.year       = year;
        this.month      = month;
        this.categories = categories || [];
        this.onSave     = onSave;
        this.onDelete   = onDelete;

        const monthPad = String(month).padStart(2, '0');
        const defaultDate = `${year}-${monthPad}-01`;

        this.modeVal        = item ? (item.type || mode) : mode;
        this.valueVal       = item ? (typeof item.value === 'number' ? item.value.toFixed(2).replace('.', ',') : String(item.value || '')) : '';
        this.descVal        = item ? (item.description || '') : '';
        this.catVal         = item ? (item.category || this.categories[0] || 'Outros') : (this.categories[0] || 'Outros');
        this.dateVal        = item ? (item.date || defaultDate) : defaultDate;
        this.isFixedVal     = item ? !!item.isFixed : false;
        this.installmentVal = item ? (item.installment || '') : '';
        this.splitDataVal   = item ? (item.splitData || null) : null;
    }

    onOpen() {
        const { contentEl, item, year, month } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper', 'kt-fin-modal-wrapper');
        this.modalEl.style.width = '520px';
        this.modalEl.style.maxWidth = '94vw';
        contentEl.empty();
        contentEl.addClass('kt-card-edit-modal');

        const isEdit = !!item;
        const monthPad = String(month).padStart(2, '0');
        const defaultDate = `${year}-${monthPad}-01`;

        contentEl.createEl('h2', { text: isEdit ? `Editar ${this.modeVal === 'income' ? 'Renda' : 'Despesa'}` : `Nova ${this.modeVal === 'income' ? 'Renda' : 'Despesa'}` });

        // 1. Tipo (Despesa / Renda)
        new obsidian.Setting(contentEl)
            .setName('Tipo de Lançamento')
            .addDropdown(d => {
                d.addOption('expense', 'Despesa (Gasto / Saída)');
                d.addOption('income', 'Renda (Ganho / Entrada)');
                d.setValue(this.modeVal);
                d.onChange(v => {
                    this.modeVal = v;
                    const catList = this.modeVal === 'income' 
                        ? (this.plugin.settings.finances.incomeCategories || ['Pagamento', 'Outros'])
                        : (this.plugin.settings.finances.categories || ['Outros']);
                    this.categories = catList;
                    this.catVal = catList[0] || 'Outros';
                    this.onOpen();
                });
            });

        // 2. Valor
        new obsidian.Setting(contentEl)
            .setName('Valor (R$)')
            .addText(t => {
                t.setPlaceholder('Ex: 400,00 ou 7.954,54')
                 .setValue(this.valueVal)
                 .onChange(v => this.valueVal = v);
                t.inputEl.style.fontSize = '16px';
                t.inputEl.style.fontWeight = '700';
                setTimeout(() => t.inputEl.focus(), 30);
            });

        // 3. Descrição
        new obsidian.Setting(contentEl)
            .setName('Descrição')
            .addText(t => {
                t.setPlaceholder('Ex: Aluguel, Ifood, Impressora 3D...')
                 .setValue(this.descVal)
                 .onChange(v => this.descVal = v);
                t.inputEl.style.width = '100%';
            });

        // 4. Categoria
        const catSetting = new obsidian.Setting(contentEl)
            .setName('Categoria');
        
        catSetting.addDropdown(d => {
            this.categories.forEach(c => d.addOption(c, c));
            if (!this.categories.includes(this.catVal)) {
                d.addOption(this.catVal, this.catVal);
            }
            d.setValue(this.catVal);
            d.onChange(v => this.catVal = v);
        });

        // Botão para criar nova categoria
        catSetting.addButton(b => {
            b.setButtonText('+').setTooltip('Criar nova categoria').onClick(() => {
                const newCat = prompt('Nome da nova categoria:');
                if (newCat && newCat.trim()) {
                    const clean = newCat.trim();
                    if (this.modeVal === 'income') {
                        if (!this.plugin.settings.finances.incomeCategories.includes(clean)) {
                            this.plugin.settings.finances.incomeCategories.push(clean);
                        }
                    } else {
                        if (!this.plugin.settings.finances.categories.includes(clean)) {
                            this.plugin.settings.finances.categories.push(clean);
                        }
                    }
                    this.plugin.saveSettings();
                    this.categories.push(clean);
                    this.catVal = clean;
                    this.onOpen();
                }
            });
        });

        // 5. Data
        new obsidian.Setting(contentEl)
            .setName('Data')
            .setDesc('Dia do gasto (ou deixe o padrão do mês)')
            .addText(t => {
                t.setValue(this.dateVal).onChange(v => this.dateVal = v.trim());
                t.inputEl.style.width = '140px';
            });

        if (this.modeVal === 'expense') {
            // 6. Parcela (opcional)
            new obsidian.Setting(contentEl)
                .setName('Parcela (Opcional)')
                .setDesc('Ex: 1/3, 27/36 ou deixe vazio se for à vista')
                .addText(t => {
                    t.setPlaceholder('Ex: 1/3')
                     .setValue(this.installmentVal)
                     .onChange(v => this.installmentVal = v.trim());
                    t.inputEl.style.width = '100px';
                });

            // 7. Gasto Fixo
            new obsidian.Setting(contentEl)
                .setName('Gasto Fixo Mensal')
                .setDesc('Repete todo mês automaticamente (Aluguel, Internet, etc.)')
                .addToggle(tg => {
                    tg.setValue(this.isFixedVal).onChange(v => this.isFixedVal = v);
                });

            // 8. Cobrança / Split de Contas
            const splitWrap = contentEl.createDiv('kt-fin-split-setting-wrap');
            splitWrap.style.margin = '12px 0';
            splitWrap.style.padding = '10px 14px';
            splitWrap.style.background = 'var(--background-secondary)';
            splitWrap.style.borderRadius = '8px';
            splitWrap.style.display = 'flex';
            splitWrap.style.justifyContent = 'space-between';
            splitWrap.style.alignItems = 'center';

            const splitInfo = splitWrap.createDiv();
            splitInfo.createDiv({ text: '👥 Cobrança de Terceiros / Split', cls: 'kt-fin-split-title' });
            
            let splitMetaText = 'Nenhuma cobrança configurada';
            if (this.splitDataVal && this.splitDataVal.participants?.length > 0) {
                const pending = this.splitDataVal.participants.filter(p => !p.settled).reduce((acc, p) => acc + (p.amount || 0), 0);
                splitMetaText = pending > 0 ? `Cobrar ${formatCurrency(pending, 'R$')} (${this.splitDataVal.participants.length} pessoas)` : '✓ Cobrança 100% quitada';
            }
            const splitMeta = splitInfo.createDiv({ text: splitMetaText, cls: 'kt-fin-split-meta-desc' });
            if (this.splitDataVal && this.splitDataVal.participants?.some(p => !p.settled)) {
                splitMeta.style.color = '#ef4444';
                splitMeta.style.fontWeight = '600';
            }

            const splitBtn = splitWrap.createEl('button', {
                text: this.splitDataVal ? 'Editar Cobrança' : 'Configurar Cobrança',
                cls: 'kt-btn-split-cfg'
            });
            splitBtn.onclick = () => {
                const tempItem = {
                    value: parseFinanceCurrencyInput(this.valueVal),
                    description: this.descVal || 'Despesa',
                    splitData: this.splitDataVal
                };
                new FinanceSplitModal(this.app, this.plugin, tempItem, 'R$', (newSplit) => {
                    this.splitDataVal = newSplit;
                    this.onOpen();
                }).open();
            };
        }

        // Footer buttons
        const footer = contentEl.createDiv('kt-modal-footer');
        footer.style.marginTop = '18px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';

        const leftGroup = footer.createDiv('kt-modal-footer-left');
        if (isEdit && this.onDelete) {
            const delBtn = leftGroup.createEl('button', { cls: 'mod-warning', text: 'Excluir' });
            delBtn.onclick = () => {
                this.close();
                this.onDelete(item);
            };
        }

        const rightGroup = footer.createDiv('kt-modal-footer-right');
        rightGroup.style.display = 'flex';
        rightGroup.style.gap = '8px';

        const cancelBtn = rightGroup.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: isEdit ? 'Salvar Alterações' : 'Adicionar' });

        const submit = () => {
            const numVal = parseFinanceCurrencyInput(this.valueVal);
            if (isNaN(numVal) || numVal <= 0) {
                new obsidian.Notice('⚠️ Digite um valor numérico válido (ex: 400,00 ou 7.954,54)');
                return;
            }
            if (!this.descVal.trim()) {
                new obsidian.Notice('⚠️ Digite uma descrição para o lançamento');
                return;
            }

            const isSplitActive = this.splitDataVal && this.splitDataVal.participants?.length > 0;

            const cleanItem = {
                id: item?.id || `fin-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                type: this.modeVal,
                value: numVal,
                description: this.descVal.trim(),
                category: this.catVal,
                date: this.dateVal.trim() || defaultDate,
                installment: this.installmentVal ? this.installmentVal.replace(/[()]/g, '').trim() : '',
                isFixed: this.isFixedVal,
                isSplit: isSplitActive,
                splitData: isSplitActive ? this.splitDataVal : null
            };

            this.close();
            this.onSave(cleanItem);
        };

        saveBtn.onclick = submit;
    }

    onClose() {
        this.contentEl.empty();
    }
}

class FinancePlannedBudgetModal extends obsidian.Modal {
    constructor(app, plugin, year, month, plannedExpenses, plannedIncome, expenseCats, incomeCats, onSave) {
        super(app);
        this.app             = app;
        this.plugin          = plugin;
        this.year            = year;
        this.month           = month;
        this.plannedExpenses = Object.assign({}, plannedExpenses);
        this.plannedIncome   = Object.assign({}, plannedIncome);
        this.expenseCats     = expenseCats || [];
        this.incomeCats      = incomeCats  || [];
        this.onSave          = onSave;
    }

    onOpen() {
        const { contentEl, year, month } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper', 'kt-fin-modal-wrapper');
        this.modalEl.style.width = '640px';
        this.modalEl.style.maxWidth = '94vw';
        this.modalEl.style.maxHeight = '88vh';
        contentEl.addClass('kt-card-edit-modal');

        const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const monthName = monthNames[month - 1];

        contentEl.createEl('h2', { text: `Metas & Orçamento Planejado • ${monthName}/${year}` });

        const scrollWrap = contentEl.createDiv('kt-fin-budget-modal-scroll');
        scrollWrap.style.maxHeight = '56vh';
        scrollWrap.style.overflowY = 'auto';
        scrollWrap.style.paddingRight = '6px';

        // 1. Despesas Planejadas por Categoria
        scrollWrap.createEl('h3', { text: 'Despesas Planejadas (Orçamento Máximo por Categoria)' });
        this.expenseCats.forEach(cat => {
            const currentVal = this.plannedExpenses[cat] != null ? String(this.plannedExpenses[cat]) : '0';
            new obsidian.Setting(scrollWrap)
                .setName(cat)
                .addText(t => {
                    t.setPlaceholder('R$ 0,00')
                     .setValue(currentVal === '0' ? '' : currentVal)
                     .onChange(v => {
                         this.plannedExpenses[cat] = parseFinanceCurrencyInput(v);
                     });
                    t.inputEl.style.width = '120px';
                });
        });

        // 2. Renda Planejada por Categoria
        scrollWrap.createEl('h3', { text: 'Renda Planejada (Previsão de Entradas)' });
        this.incomeCats.forEach(cat => {
            const currentVal = this.plannedIncome[cat] != null ? String(this.plannedIncome[cat]) : '0';
            new obsidian.Setting(scrollWrap)
                .setName(cat)
                .addText(t => {
                    t.setPlaceholder('R$ 0,00')
                     .setValue(currentVal === '0' ? '' : currentVal)
                     .onChange(v => {
                         this.plannedIncome[cat] = parseFinanceCurrencyInput(v);
                     });
                    t.inputEl.style.width = '120px';
                });
        });

        // Footer buttons
        const footer = contentEl.createDiv('kt-modal-footer');
        footer.style.marginTop = '18px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';
        footer.style.alignItems = 'center';

        const applyAllBtn = footer.createEl('button', {
            text: `Aplicar para todo o ano de ${year}`,
            cls: 'kt-btn-apply-all'
        });
        applyAllBtn.title = `Copia essas metas de orçamento para todos os 12 meses de ${year}`;
        applyAllBtn.onclick = () => {
            this.close();
            this.onSave(this.plannedExpenses, this.plannedIncome, true);
        };

        const rightGroup = footer.createDiv('kt-modal-footer-right');
        rightGroup.style.display = 'flex';
        rightGroup.style.gap = '8px';

        const cancelBtn = rightGroup.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: 'Salvar Mês' });
        saveBtn.onclick = () => {
            this.close();
            this.onSave(this.plannedExpenses, this.plannedIncome, false);
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class FinanceInitialBalanceModal extends obsidian.Modal {
    constructor(app, currentVal, monthName, year, onSave) {
        super(app);
        this.app        = app;
        this.currentVal = currentVal;
        this.monthName  = monthName;
        this.year       = year;
        this.onSave     = onSave;
    }

    onOpen() {
        const { contentEl, currentVal, monthName, year } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper', 'kt-fin-modal-wrapper');
        this.modalEl.style.width = '420px';
        contentEl.addClass('kt-card-edit-modal');

        contentEl.createEl('h2', { text: `Saldo Inicial • ${monthName}/${year}` });

        let valStr = currentVal != null ? String(currentVal) : '';

        new obsidian.Setting(contentEl)
            .setName('Saldo Inicial (R$)')
            .setDesc('Saldo em conta no primeiro dia do mês')
            .addText(t => {
                t.setValue(valStr)
                 .setPlaceholder('Ex: 29.102,00')
                 .onChange(v => valStr = v);
                t.inputEl.style.fontSize = '15px';
                t.inputEl.style.fontWeight = '700';
                setTimeout(() => t.inputEl.focus(), 30);
            });

        const footer = contentEl.createDiv('kt-modal-footer');
        footer.style.marginTop = '18px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '8px';

        const cancelBtn = footer.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = footer.createEl('button', { cls: 'mod-cta', text: 'Salvar Saldo' });
        saveBtn.onclick = () => {
            const num = parseFinanceCurrencyInput(valStr);
            this.close();
            this.onSave(num);
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class FinanceImportModal extends obsidian.Modal {
    constructor(app, plugin, targetYear, targetMonth, onImportDone) {
        super(app);
        this.app          = app;
        this.plugin       = plugin;
        this.targetYear   = targetYear;
        this.targetMonth  = targetMonth;
        this.onImportDone = onImportDone;
    }

    onOpen() {
        const { contentEl, targetYear, targetMonth } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper', 'kt-fin-modal-wrapper');
        this.modalEl.style.width = '680px';
        this.modalEl.style.maxWidth = '94vw';
        this.modalEl.style.maxHeight = '90vh';
        contentEl.addClass('kt-card-edit-modal');

        const monthName = getFinanceMonthName(targetMonth);
        contentEl.createEl('h2', { text: `📥 Importar Planilha de Gastos (${monthName}/${targetYear})` });

        const desc = contentEl.createEl('p', { cls: 'kt-modal-desc' });
        desc.setText(`Os dados serão importados exclusivamente para o mês selecionado (${String(targetMonth).padStart(2,'0')}/${targetYear}), garantindo isolamento total sem alterar outros meses.`);

        // File upload input supporting multiple files
        const fileRow = contentEl.createDiv('kt-fin-import-file-row');
        fileRow.style.margin = '10px 0';
        fileRow.style.display = 'flex';
        fileRow.style.flexDirection = 'column';
        fileRow.style.gap = '6px';

        const fileInputWrap = fileRow.createDiv();
        fileInputWrap.style.display = 'flex';
        fileInputWrap.style.alignItems = 'center';
        fileInputWrap.style.gap = '10px';

        const fileInput = fileInputWrap.createEl('input', {
            type: 'file',
            attr: { accept: '.csv,.tsv,.txt', multiple: 'multiple' }
        });

        const fileStatus = fileRow.createDiv('kt-fin-import-file-status');
        fileStatus.style.fontSize = '12px';
        fileStatus.style.color = 'var(--text-muted)';
        fileStatus.style.fontWeight = '500';

        // Textarea for pasting
        const textarea = contentEl.createEl('textarea', {
            cls: 'kt-fin-import-textarea',
            attr: {
                placeholder: `Cole aqui os dados de ${monthName}/${targetYear} (Ctrl+V) ou selecione arquivos CSV acima...\nExemplo:\n${monthName.toLowerCase()}\tR$400,00\tPlano de saúde Caio\tSaúde\n(1/3)\tR$1.336,67\tImpressora 3D\tLazer\n06/${String(targetMonth).padStart(2,'0')}/${targetYear}\tR$282,19\tIfood ( 60 clara 60 julia lage)\tLazer`,
                rows: 10
            }
        });
        textarea.style.width = '100%';
        textarea.style.fontFamily = 'monospace';
        textarea.style.fontSize = '12px';

        fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;

            if (files.length === 1) {
                const text = await files[0].text();
                textarea.value = text;
                fileStatus.setText(`📄 1 arquivo selecionado: ${files[0].name}`);
            } else {
                const fileChunks = [];
                for (const f of files) {
                    const t = await f.text();
                    fileChunks.push(t);
                }
                textarea.value = fileChunks.join('\n\n');
                fileStatus.setText(`📁 ${files.length} arquivos CSV selecionados`);
            }
        });

        const infoBox = contentEl.createDiv('kt-fin-import-info-badge');
        infoBox.style.marginTop = '10px';
        infoBox.style.padding = '8px 12px';
        infoBox.style.background = 'var(--background-secondary)';
        infoBox.style.borderRadius = '6px';
        infoBox.style.fontSize = '12px';
        infoBox.style.color = 'var(--text-muted)';
        infoBox.setText(`📌 Destino bloqueado: ${monthName}/${targetYear} (${String(targetMonth).padStart(2,'0')}/${targetYear}). Nenhuma entrada será enviada para outros meses.`);

        // Footer buttons
        const footer = contentEl.createDiv('kt-modal-footer');
        footer.style.marginTop = '16px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '8px';

        const cancelBtn = footer.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const parseBtn = footer.createEl('button', { cls: 'mod-cta', text: `Importar para ${monthName}/${targetYear}` });
        parseBtn.onclick = () => {
            const rawText = textarea.value.trim();
            if (!rawText) {
                new obsidian.Notice('⚠️ Cole os dados ou selecione arquivos CSV antes de continuar.');
                return;
            }

            const res = this.parseAndSaveData(rawText, 'current');
            this.close();
            if (this.onImportDone) this.onImportDone(res);
        };
    }

    parseAndSaveData(rawText, mode) {
        const lines = rawText.split('\n');
        const monthsData = this.plugin.settings.finances.months;
        const currentMonthKey = `${this.targetYear}-${String(this.targetMonth).padStart(2, '0')}`;

        // Save deep clone snapshot before modifying data for Undo functionality
        const snapshotBefore = JSON.parse(JSON.stringify(monthsData));

        const monthNameMap = {
            'janeiro': 1, 'jan': 1, 'fevereiro': 2, 'fev': 2, 'março': 3, 'marco': 3, 'mar': 3,
            'abril': 4, 'abr': 4, 'maio': 5, 'mai': 5, 'junho': 6, 'jun': 6,
            'julho': 7, 'jul': 7, 'agosto': 8, 'ago': 8, 'setembro': 9, 'set': 9,
            'outubro': 10, 'out': 10, 'novembro': 11, 'nov': 11, 'dezembro': 12, 'dez': 12
        };

        let activeYear = this.targetYear;
        let activeMonth = this.targetMonth;
        let lastSeenDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-01`;

        const tokenizeLine = (text) => {
            const isTabDelimited = text.includes('\t');
            const result = [];
            let cur = '';
            let inQuotes = false;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (char === '"' || char === "'") {
                    if (inQuotes && text[i+1] === char) {
                        cur += char;
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (isTabDelimited) {
                    if (char === '\t' && !inQuotes) {
                        result.push(cur.trim());
                        cur = '';
                    } else {
                        cur += char;
                    }
                } else {
                    if ((char === ',' || char === ';') && !inQuotes) {
                        result.push(cur.trim());
                        cur = '';
                    } else {
                        cur += char;
                    }
                }
            }
            result.push(cur.trim());
            return result;
        };

        let importedCount = 0;
        let duplicateCount = 0;

        // Build inventory of existing items per month key to allow legitimate duplicate transactions on the same day
        const existingInventory = {};
        Object.keys(monthsData).forEach(mKey => {
            existingInventory[mKey] = { expenses: {}, income: {} };
            const m = monthsData[mKey];
            if (m && Array.isArray(m.expenses)) {
                m.expenses.forEach(e => {
                    const k = `${(e.description || '').trim().toLowerCase()}|||${(e.value || 0).toFixed(2)}|||${e.date || ''}|||${e.installment || ''}`;
                    existingInventory[mKey].expenses[k] = (existingInventory[mKey].expenses[k] || 0) + 1;
                });
            }
            if (m && Array.isArray(m.income)) {
                m.income.forEach(i => {
                    const k = `${(i.description || '').trim().toLowerCase()}|||${(i.value || 0).toFixed(2)}|||${i.date || ''}`;
                    existingInventory[mKey].income[k] = (existingInventory[mKey].income[k] || 0) + 1;
                });
            }
        });

        const parseSingleItem = (rawDate, rawVal, rawDesc, rawCat, forcedType = null) => {
            if (!rawVal || !rawDesc) return null;

            const isSummaryKeyword = (str) => {
                if (!str) return false;
                const s = str.trim().toLowerCase();
                return s === 'total' || s === 'subtotal' || s === 'final' || s === 'saldo' ||
                       s === 'saldo inicial' || s === 'saldo final' || s === 'diferença' ||
                       s === 'diferenca' || s === 'planejado' || s === 'real' || s === 'resumo' ||
                       s === 'descrição' || s === 'descricao' || s === 'valor' || s === 'data';
            };

            if (isSummaryKeyword(rawDesc) || isSummaryKeyword(rawDate) || isSummaryKeyword(rawCat)) return null;

            // Check if rawVal has split comments e.g. "325 ( 63 - Julia / 61 + 61 Ana e tuts)"
            const valSplitMatch = String(rawVal).match(/\((.*?)\)/);
            if (valSplitMatch) {
                rawDesc = `${rawDesc} ${valSplitMatch[0]}`.trim();
            }

            const numVal = parseFinanceCurrencyInput(rawVal);
            if (isNaN(numVal) || numVal <= 0) return null;

            let isFixed = false;
            let installment = '';
            let finalDateStr = lastSeenDateStr;
            let targetKey = currentMonthKey;

            const trimmedDate = (rawDate || '').trim();
            const lowerDate = trimmedDate.toLowerCase();

            if (trimmedDate) {
                // 1. Check if rawDate is a Month Name (e.g. 'janeiro', 'julho', 'abril') -> Gasto Fixo
                let isMonthName = false;
                for (const [mName, mNum] of Object.entries(monthNameMap)) {
                    if (lowerDate.includes(mName)) {
                        isMonthName = true;
                        isFixed = true;
                        finalDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-01`;
                        break;
                    }
                }

                if (!isMonthName) {
                    // 2. Check if rawDate is an Installment: (21/36), (2/3), (3/6), (2/5)
                    const isParenthesized = /^\(\d+\/\d+\)$/.test(trimmedDate);
                    const instMatch = trimmedDate.match(/^\(?(\d{1,2})[\/\-](\d{1,2})\)?$/);

                    if (isParenthesized && instMatch) {
                        // Explicitly formatted as an installment e.g. (21/36) or (3/6)
                        installment = `${instMatch[1]}/${instMatch[2]}`;
                        finalDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-01`;
                    } else if (instMatch) {
                        const p1Str = instMatch[1];
                        const p2Str = instMatch[2];
                        const p1 = parseInt(p1Str, 10);
                        const p2 = parseInt(p2Str, 10);

                        // If it has full year: DD/MM/YYYY or DD-MM-YYYY
                        const ddmmyyyy = trimmedDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                        if (ddmmyyyy) {
                            const day = String(ddmmyyyy[1]).padStart(2, '0');
                            finalDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-${day}`;
                            lastSeenDateStr = finalDateStr;
                        } else if (p1 > 12 && p2 >= 1 && p2 <= 12) {
                            // "23/01" -> Day 23
                            const day = String(p1).padStart(2, '0');
                            finalDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-${day}`;
                            lastSeenDateStr = finalDateStr;
                        } else if (p1Str.startsWith('0') && p1 >= 1 && p1 <= 31 && p2 >= 1 && p2 <= 12) {
                            // "03/01" -> Day 03
                            const day = String(p1).padStart(2, '0');
                            finalDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-${day}`;
                            lastSeenDateStr = finalDateStr;
                        } else if (p1 <= p2 && p2 > 1) {
                            // "2/3", "3/6", "2/5" -> Installment!
                            installment = `${p1}/${p2}`;
                            finalDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-01`;
                        } else {
                            // Default day
                            const day = String(p1).padStart(2, '0');
                            finalDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-${day}`;
                            lastSeenDateStr = finalDateStr;
                        }
                    } else {
                        // Full date check DD/MM/YYYY
                        const ddmmyyyy = trimmedDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                        if (ddmmyyyy) {
                            const day = String(ddmmyyyy[1]).padStart(2, '0');
                            finalDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-${day}`;
                            lastSeenDateStr = finalDateStr;
                        }
                    }
                }
            } else {
                // Empty date cell -> Inherit lastSeenDateStr from preceding transaction of the same day!
                finalDateStr = lastSeenDateStr;
            }

            // Also check if installment is inside description text e.g. "TOKSTOK 1/3" or "Carro (21/36)"
            if (!installment) {
                const descInstMatch = rawDesc.match(/\(?(\d+\/\d+)\)?/);
                if (descInstMatch) {
                    const parts = descInstMatch[1].split('/');
                    const dp1 = parseInt(parts[0], 10);
                    const dp2 = parseInt(parts[1], 10);
                    if (dp1 <= dp2 || dp2 > 12) {
                        installment = descInstMatch[1];
                        rawDesc = rawDesc.replace(descInstMatch[0], '').trim();
                    }
                }
            }

            // Detect split / toCollect (parenthesis with names or numbers)
            let isSplit = false;
            let splitData = null;
            const splitMatch = rawDesc.match(/\((.*?clara.*?|.*?julia.*?|.*?pagu.*?|\d+\s+[a-zA-Z]+.*?|[a-zA-Z]+\s+\d+.*?)\)/i);
            if (splitMatch) {
                isSplit = true;
                const splitText = splitMatch[1].trim();
                rawDesc = rawDesc.replace(splitMatch[0], '').trim();

                const participants = [];
                const chunks = splitText.split(/,|\be\b|\+/i);
                chunks.forEach(chunk => {
                    const cTrim = chunk.trim();
                    if (!cTrim) return;

                    const pairRegex = /(\d+[\.,]?\d*)\s*[-:]?\s*([a-zA-Z\s]+?)(?=\s+\d+|$)|([a-zA-Z\s]+?)\s*[-:]?\s*(\d+[\.,]?\d*)/g;
                    let match;
                    let foundAny = false;
                    while ((match = pairRegex.exec(cTrim)) !== null) {
                        foundAny = true;
                        let amt = 0;
                        let name = 'Pessoa';
                        if (match[1] && match[2]) {
                            amt = parseFinanceCurrencyInput(match[1]);
                            name = match[2].trim();
                        } else if (match[3] && match[4]) {
                            amt = parseFinanceCurrencyInput(match[4]);
                            name = match[3].trim();
                        }
                        if (name && !isNaN(amt) && amt > 0) {
                            participants.push({
                                name: name.charAt(0).toUpperCase() + name.slice(1),
                                amount: amt,
                                settled: false
                            });
                        }
                    }

                    if (!foundAny) {
                        const matchVal = cTrim.match(/(\d+[\.,]?\d*)/);
                        const num = matchVal ? parseFinanceCurrencyInput(matchVal[1]) : 0;
                        const name = cTrim.replace(matchVal ? matchVal[0] : '', '').replace(/[-:]/g, '').trim() || 'Pessoa';
                        if (num > 0 || name !== 'Pessoa') {
                            participants.push({
                                name: name.charAt(0).toUpperCase() + name.slice(1),
                                amount: num,
                                settled: false
                            });
                        }
                    }
                });

                const totalToCollect = participants.reduce((sum, p) => sum + (p.amount || 0), 0);
                splitData = {
                    isSplit: true,
                    participants,
                    totalToCollect
                };
            }

            const incomeCats = this.plugin.settings.finances.incomeCategories || ['Pagamento', 'Poupança', 'Bônus', 'Juros', 'Outros'];
            const isIncome = forcedType === 'income' || (forcedType !== 'expense' && (incomeCats.some(ic => ic.toLowerCase() === rawCat.toLowerCase()) || rawDesc.toLowerCase().includes('pagamento') || rawDesc.toLowerCase().includes('salario')));

            if (mode === 'current') {
                targetKey = currentMonthKey;
            }

            return {
                targetKey,
                item: {
                    id: `fin-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    type: isIncome ? 'income' : 'expense',
                    value: numVal,
                    description: rawDesc.replace(/^["']|["']$/g, '').trim(),
                    category: rawCat.replace(/^["']|["']$/g, '').trim() || (isIncome ? 'Pagamento' : 'Outros'),
                    date: finalDateStr,
                    installment,
                    isFixed,
                    isSplit,
                    splitData
                }
            };
        };

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;

            // Check for file separator header
            const fileHdrMatch = trimmed.match(/^#\s*---\s*ARQUIVO:\s*(.*?)\s*---$/i);
            if (fileHdrMatch) {
                const fname = fileHdrMatch[1].toLowerCase();
                const yMatch = fname.match(/\b(202\d)\b/);
                if (yMatch) activeYear = parseInt(yMatch[1], 10);

                for (const [mName, mNum] of Object.entries(monthNameMap)) {
                    if (fname.includes(mName)) {
                        activeMonth = mNum;
                        break;
                    }
                }
                lastSeenDateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-01`;
                return;
            }

            if (trimmed.startsWith('#')) return;

            // Tokenize CSV row keeping all columns
            const row = tokenizeLine(line);
            if (row.length === 0) return;

            // Helper to add item with inventory-based deduplication
            const tryAddItem = (res) => {
                if (!res || !res.item) return;
                const tKey = res.targetKey;
                if (!monthsData[tKey]) {
                    monthsData[tKey] = { initialBalance: null, plannedExpenses: {}, plannedIncome: {}, expenses: [], income: [] };
                }
                if (!existingInventory[tKey]) {
                    existingInventory[tKey] = { expenses: {}, income: {} };
                }

                const listType = res.item.type === 'income' ? 'income' : 'expenses';
                if (!monthsData[tKey][listType]) monthsData[tKey][listType] = [];

                const itemKey = `${(res.item.description || '').trim().toLowerCase()}|||${(res.item.value || 0).toFixed(2)}|||${res.item.date || ''}|||${res.item.installment || ''}`;
                const remainingDuplicates = existingInventory[tKey][listType][itemKey] || 0;

                if (remainingDuplicates > 0) {
                    // Match found in existing database -> skip duplicate!
                    existingInventory[tKey][listType][itemKey]--;
                    duplicateCount++;
                } else {
                    // New item -> add to list!
                    monthsData[tKey][listType].push(res.item);
                    importedCount++;
                }
            };

            // Detect column layout:
            if (row.length >= 5) {
                const isVal1 = /^R?\$?\s*\d+/i.test(row[1]);
                const isVal2 = /^R?\$?\s*\d+/i.test(row[2]);

                if (isVal2) {
                    // Google Sheets 10-column layout: [empty, date, val, desc, cat, empty, date_inc, val_inc, desc_inc, cat_inc]
                    const expRes = parseSingleItem(row[1], row[2], row[3], row[4] || 'Outros', 'expense');
                    tryAddItem(expRes);

                    if (row.length >= 9 && row[7]) {
                        const incRes = parseSingleItem(row[6], row[7], row[8], row[9] || 'Pagamento', 'income');
                        tryAddItem(incRes);
                    }
                } else if (isVal1) {
                    // 5-column layout: [date, val, desc, cat, ...]
                    const expRes = parseSingleItem(row[0], row[1], row[2], row[3] || 'Outros', 'expense');
                    tryAddItem(expRes);
                }
            } else if (row.length >= 2) {
                // Simple 2..4 column layout
                const isVal0 = /^R?\$?\s*\d+/i.test(row[0]);
                const isVal1 = /^R?\$?\s*\d+/i.test(row[1]);

                let rDate = '', rVal = '', rDesc = '', rCat = '';
                if (row.length === 4) {
                    if (isVal1 || !isVal0) {
                        rDate = row[0]; rVal = row[1]; rDesc = row[2]; rCat = row[3];
                    } else {
                        rVal = row[0]; rDesc = row[1]; rCat = row[2];
                    }
                } else if (row.length === 3) {
                    if (isVal1) {
                        rDate = row[0]; rVal = row[1]; rDesc = row[2];
                    } else if (isVal0) {
                        rVal = row[0]; rDesc = row[1]; rCat = row[2];
                    } else {
                        rDate = row[0]; rDesc = row[1]; rVal = row[2];
                    }
                } else if (row.length === 2) {
                    if (isVal0) {
                        rVal = row[0]; rDesc = row[1];
                    } else {
                        rDesc = row[0]; rVal = row[1];
                    }
                }
                const res = parseSingleItem(rDate, rVal, rDesc, rCat);
                tryAddItem(res);
            }
        });

        this.plugin.saveSettings();
        return { importedCount, duplicateCount, snapshotBefore };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class FinanceConfirmModal extends obsidian.Modal {
    constructor(app, title, message, onConfirm) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper', 'kt-fin-modal-wrapper');
        this.modalEl.style.width = '440px';
        contentEl.addClass('kt-card-edit-modal');

        contentEl.createEl('h2', { text: this.title });
        const p = contentEl.createEl('p', { cls: 'kt-modal-desc' });
        p.setText(this.message);
        p.style.lineHeight = '1.5';
        p.style.margin = '12px 0 18px 0';

        const footer = contentEl.createDiv('kt-modal-footer');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '10px';

        const cancelBtn = footer.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = footer.createEl('button', { cls: 'mod-warning', text: 'Confirmar e Apagar' });
        confirmBtn.onclick = () => {
            this.close();
            this.onConfirm();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ================================================================
// TIME BLOCK MODAL
// ================================================================

class TimeBlockModal extends obsidian.Modal {
    constructor(app, card, date, defaultHour, onSave, onDelete) {
        super(app);
        this.card        = card;
        this.date        = date;
        this.defaultHour = defaultHour;
        this.onSave      = onSave;
        this.onDelete    = onDelete;
    }

    onOpen() {
        const { contentEl, card, date } = this;
        contentEl.addClass('kt-modal');
        const dateStr = date ? formatDate(date) : null;
        contentEl.createEl('h2', { text: `⏰ Horário: ${card.title}${dateStr ? ` (${dateStr})` : ''}` });

        const pad = n => String(n).padStart(2, '0');
        const dayTime = getTimeForDay(card, date);

        let titleVal = card.title;
        let startVal = dayTime?.timeStart || `${pad(this.defaultHour)}:00`;
        let endVal   = dayTime?.timeEnd   || `${pad(this.defaultHour + 1)}:00`;
        let applyToAll = false;

        const isRoutineOrEvent = card.isEvent || card.column === 'Rotina' || !!card.seriesId;

        if (isRoutineOrEvent) {
            new obsidian.Setting(contentEl)
                .setName('Nome do Evento')
                .addText(t => {
                    t.setValue(titleVal);
                    t.onChange(v => titleVal = v);
                });
        }

        new obsidian.Setting(contentEl)
            .setName('Início').addText(t => { t.setValue(startVal); t.onChange(v => startVal = v); });

        new obsidian.Setting(contentEl)
            .setName('Fim').addText(t => { t.setValue(endVal); t.onChange(v => endVal = v); });

        if (isRoutineOrEvent) {
            new obsidian.Setting(contentEl)
                .setName('Escopo da Alteração')
                .setDesc('Aplicar alteração neste evento ou em toda a série')
                .addDropdown(d => {
                    d.addOption('single', `Apenas neste dia (${dateStr})`);
                    d.addOption('all', `Toda a série recorrente (${card.title})`);
                    d.setValue('single');
                    d.onChange(v => applyToAll = (v === 'all'));
                });
        }

        const buttonsRow = new obsidian.Setting(contentEl);

        buttonsRow.addButton(b => b.setButtonText('Salvar').setCta().onClick(() => {
            if (!/^\d{2}:\d{2}$/.test(startVal) || !/^\d{2}:\d{2}$/.test(endVal)) {
                new obsidian.Notice('Formato inválido. Use HH:mm');
                return;
            }
            this.onSave(titleVal, startVal, endVal, applyToAll);
            this.close();
        }));

        buttonsRow.addButton(b => b.setButtonText('Limpar deste dia').setWarning().onClick(() => {
            if (this.onDelete) {
                this.onDelete(false);
            } else {
                this.onSave(titleVal, null, null, false);
            }
            this.close();
        }));

        if (isRoutineOrEvent) {
            buttonsRow.addButton(b => b.setButtonText('Excluir toda a série').setWarning().onClick(() => {
                new ConfirmDeleteModal(this.app, `toda a série "${card.title}"`, () => {
                    if (this.onDelete) {
                        this.onDelete(true);
                    }
                    this.close();
                }).open();
            }));
        }

        buttonsRow.addButton(b => b.setButtonText('Cancelar').onClick(() => this.close()));
    }

    onClose() { this.contentEl.empty(); }
}

function colorMixHex(hex, alpha = 0.2) {
    if (!hex || typeof hex !== 'string') return `rgba(99, 102, 241, ${alpha})`;
    if (hex.startsWith('#') && hex.length === 7) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return hex;
}

// ================================================================
// ICAL / GOOGLE CALENDAR PARSER (RFC 5545)
// ================================================================

class ICalParser {
    static parse(icsData, calendarConfig = {}) {
        if (!icsData || typeof icsData !== 'string') return [];

        // 1. Unfold lines (RFC 5545 3.1)
        const unfolded = icsData.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
        const lines = unfolded.split(/\r\n|\r|\n/);

        const rawEvents = [];
        let inEvent = false;
        let cur = null;
        let defaultTz = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line === 'BEGIN:VEVENT') {
                inEvent = true;
                cur = {};
                continue;
            }

            if (line === 'END:VEVENT') {
                if (cur) {
                    rawEvents.push(cur);
                }
                inEvent = false;
                cur = null;
                continue;
            }

            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;

            const propPart = line.substring(0, colonIdx);
            const valPart = line.substring(colonIdx + 1);

            const semicolonIdx = propPart.indexOf(';');
            const propName = (semicolonIdx !== -1 ? propPart.substring(0, semicolonIdx) : propPart).toUpperCase();
            const propParams = semicolonIdx !== -1 ? propPart.substring(semicolonIdx + 1) : '';

            if (!inEvent) {
                if (propName === 'X-WR-TIMEZONE') {
                    defaultTz = valPart.trim();
                }
                continue;
            }

            if (!cur) continue;

            if (propName === 'SUMMARY') cur.summary = ICalParser.unescapeText(valPart);
            else if (propName === 'DESCRIPTION') cur.description = ICalParser.unescapeText(valPart);
            else if (propName === 'LOCATION') cur.location = ICalParser.unescapeText(valPart);
            else if (propName === 'STATUS') cur.status = valPart.toUpperCase();
            else if (propName === 'UID') cur.uid = valPart;
            else if (propName === 'RECURRENCE-ID') cur.recurrenceId = { val: valPart, params: propParams };
            else if (propName === 'DTSTART') cur.dtstart = { val: valPart, params: propParams };
            else if (propName === 'DTEND') cur.dtend = { val: valPart, params: propParams };
            else if (propName === 'DURATION') cur.duration = valPart;
            else if (propName === 'RRULE') cur.rrule = valPart;
            else if (propName === 'EXDATE') {
                if (!cur.exdates) cur.exdates = [];
                cur.exdates.push({ val: valPart, params: propParams });
            }
            else if (propName === 'URL') cur.url = valPart;
            else if (propName === 'X-GOOGLE-CONFERENCE') cur.conference = valPart;
        }

        // 2. Group events by UID to correlate recurring series with exception/override VEVENTs
        const eventsByUid = new Map();
        for (const raw of rawEvents) {
            const uid = raw.uid || ('evt-' + Math.random().toString(36).substr(2, 9));
            raw.uid = uid;
            if (!eventsByUid.has(uid)) {
                eventsByUid.set(uid, []);
            }
            eventsByUid.get(uid).push(raw);
        }

        const events = [];

        for (const [uid, group] of eventsByUid.entries()) {
            // Identify master recurring event (has RRULE and no RECURRENCE-ID)
            const masterEvent = group.find(e => e.rrule && !e.recurrenceId);
            // All override/exception instances (have RECURRENCE-ID)
            const overrideEvents = group.filter(e => e.recurrenceId);
            // Standalone non-recurring events in this group
            const standaloneEvents = group.filter(e => e !== masterEvent && !e.recurrenceId);

            // Collect all dates that were overridden or cancelled
            const overriddenDateKeys = new Set();
            for (const ov of overrideEvents) {
                if (ov.recurrenceId) {
                    const parsedRec = ICalParser.parseDate(ov.recurrenceId, defaultTz);
                    if (parsedRec && parsedRec.date) {
                        overriddenDateKeys.add(formatDate(parsedRec.date));
                    }
                }
            }

            // 1. Process master recurring event (if active)
            if (masterEvent && masterEvent.status !== 'CANCELLED') {
                const parsedMaster = ICalParser.processEvent(masterEvent, calendarConfig, overriddenDateKeys, defaultTz);
                events.push(...parsedMaster);
            }

            // 2. Process override/exception events (the updated/rescheduled instances)
            for (const ov of overrideEvents) {
                if (ov.status !== 'CANCELLED') {
                    const parsedOv = ICalParser.processEvent(ov, calendarConfig, null, defaultTz);
                    events.push(...parsedOv);
                }
            }

            // 3. Process standalone non-recurring events
            for (const st of standaloneEvents) {
                if (st.status !== 'CANCELLED') {
                    const parsedSt = ICalParser.processEvent(st, calendarConfig, null, defaultTz);
                    events.push(...parsedSt);
                }
            }
        }

        // 3. Deduplication: prevent multiple events with same UID on the same day
        const seen = new Map();
        for (const evt of events) {
            const key = `${evt.calendarId}::${evt.uid}::${formatDate(evt.startDate)}`;
            seen.set(key, evt);
        }

        return Array.from(seen.values());
    }

    static unescapeText(str) {
        if (!str) return '';
        return str.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    }

    static parseDate(dtObj, defaultTz = null) {
        if (!dtObj) return null;
        const rawVal = typeof dtObj === 'string' ? dtObj : (dtObj.val || '');
        const raw = rawVal.trim();
        if (!raw) return null;
        
        // Formato YYYYMMDD (All day)
        if (/^\d{8}$/.test(raw)) {
            const y = parseInt(raw.substring(0, 4), 10);
            const m = parseInt(raw.substring(4, 6), 10) - 1;
            const d = parseInt(raw.substring(6, 8), 10);
            return { date: new Date(y, m, d, 0, 0, 0), isAllDay: true };
        }

        const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
        if (!match) return null;

        const y = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const d = parseInt(match[3], 10);
        const h = parseInt(match[4], 10);
        const min = parseInt(match[5], 10);
        const s = parseInt(match[6], 10);
        const isUtc = !!match[7];

        if (isUtc) {
            const dt = new Date(Date.UTC(y, m - 1, d, h, min, s));
            return { date: dt, isAllDay: false };
        }

        // Extract TZID from params (e.g. "TZID=Europe/London" or "TZID=America/Sao_Paulo")
        let tz = null;
        if (typeof dtObj === 'object' && dtObj.params) {
            const tzMatch = dtObj.params.match(/TZID=([^;:]+)/i);
            if (tzMatch) tz = tzMatch[1].replace(/^["']|["']$/g, '').trim();
        }
        if (!tz) tz = defaultTz;

        if (tz) {
            try {
                const utcGuess = Date.UTC(y, m - 1, d, h, min, s);
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    year: 'numeric', month: 'numeric', day: 'numeric',
                    hour: 'numeric', minute: 'numeric', second: 'numeric',
                    hour12: false
                });
                const parts = formatter.formatToParts(new Date(utcGuess));
                const pMap = {};
                parts.forEach(p => pMap[p.type] = p.value);
                let fH = parseInt(pMap.hour, 10);
                if (fH === 24) fH = 0;
                const formattedUtc = Date.UTC(
                    parseInt(pMap.year, 10),
                    parseInt(pMap.month, 10) - 1,
                    parseInt(pMap.day, 10),
                    fH,
                    parseInt(pMap.minute, 10),
                    parseInt(pMap.second, 10)
                );
                const offset = formattedUtc - utcGuess;
                const dt = new Date(utcGuess - offset);
                return { date: dt, isAllDay: false };
            } catch (e) {
                console.warn(`[Kanban Timeline] Timezone "${tz}" não suportado, usando horário local:`, e);
            }
        }

        return { date: new Date(y, m - 1, d, h, min, s), isAllDay: false };
    }

    static processEvent(raw, cal, extraExdates = null, defaultTz = null) {
        if (raw.status === 'CANCELLED') return [];
        const parsedStart = ICalParser.parseDate(raw.dtstart, defaultTz);
        if (!parsedStart || !parsedStart.date || isNaN(parsedStart.date.getTime())) return [];

        let parsedEnd = ICalParser.parseDate(raw.dtend, defaultTz);
        if (!parsedEnd || !parsedEnd.date) {
            const endDate = new Date(parsedStart.date);
            if (parsedStart.isAllDay) {
                endDate.setDate(endDate.getDate() + 1);
            } else {
                endDate.setHours(endDate.getHours() + 1);
            }
            parsedEnd = { date: endDate, isAllDay: parsedStart.isAllDay };
        }

        const durationMinutes = Math.max(15, Math.round((parsedEnd.date.getTime() - parsedStart.date.getTime()) / 60000));
        const summary = raw.summary || '(Sem Título)';
        const description = raw.description || '';
        const location = raw.location || '';
        const uid = raw.uid || ('evt-' + Math.random().toString(36).substr(2, 9));

        // Find meeting URL
        const fullText = `${location} ${description} ${raw.conference || ''} ${raw.url || ''}`;
        const meetMatch = fullText.match(/https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[a-zA-Z0-9.-]*zoom\.us\/[^\s]+|teams\.microsoft\.com\/[^\s]+)/i);
        const meetUrl = meetMatch ? meetMatch[0] : null;

        const baseEvent = {
            uid,
            calendarId: cal.id,
            calendarName: cal.name || '',
            calendarColor: cal.color || '#3b82f6',
            cleanTitle: summary,
            title: summary,
            description,
            location,
            meetUrl,
            status: raw.status || 'CONFIRMED',
            isAllDay: parsedStart.isAllDay,
            isEvent: true,
            isRemoteCalendarEvent: true,
            eventType: 'meeting',
            column: 'Rotina',
            tags: []
        };

        const now = new Date();
        const windowStart = new Date(now.getTime() - 30 * 86400000);
        const windowEnd = new Date(now.getTime() + 90 * 86400000);

        // Check for Recurrence RRULE
        if (raw.rrule) {
            return ICalParser.expandRecurrence(baseEvent, parsedStart.date, durationMinutes, raw.rrule, raw.exdates, extraExdates, windowStart, windowEnd, defaultTz);
        }

        // Single Event
        if (parsedEnd.date >= windowStart && parsedStart.date <= windowEnd) {
            const d = parsedStart.date;
            const pad = n => String(n).padStart(2, '0');
            const timeStart = parsedStart.isAllDay ? '08:00' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            const endD = parsedEnd.date;
            const timeEnd = parsedStart.isAllDay ? '09:00' : `${pad(endD.getHours())}:${pad(endD.getMinutes())}`;

            return [{
                ...baseEvent,
                id: `remote-${cal.id}-${uid}-${formatDate(d)}`,
                startDate: d,
                endDate: d,
                timeStart,
                timeEnd,
                durationMinutes
            }];
        }

        return [];
    }

    static expandRecurrence(baseEvent, origStart, durationMinutes, rruleStr, exdates, extraExdates, windowStart, windowEnd, defaultTz = null) {
        const events = [];
        const parts = {};
        rruleStr.split(';').forEach(p => {
            const [k, v] = p.split('=');
            if (k && v) parts[k.toUpperCase()] = v.toUpperCase();
        });

        const freq = parts.FREQ;
        const interval = parseInt(parts.INTERVAL || '1', 10);
        const count = parts.COUNT ? parseInt(parts.COUNT, 10) : 9999;
        
        let untilDate = null;
        if (parts.UNTIL) {
            const parsedUntil = ICalParser.parseDate({ val: parts.UNTIL }, defaultTz);
            if (parsedUntil) untilDate = parsedUntil.date;
        }

        const byDays = parts.BYDAY ? parts.BYDAY.split(',') : null;
        const dayMap = { 'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6 };

        const exdateSet = new Set();
        if (extraExdates) {
            extraExdates.forEach(dKey => exdateSet.add(dKey));
        }

        if (exdates && Array.isArray(exdates)) {
            exdates.forEach(exEntry => {
                const rawVal = typeof exEntry === 'string' ? exEntry : (exEntry.val || '');
                const params = typeof exEntry === 'object' ? exEntry.params : '';
                const items = rawVal.split(',');
                items.forEach(item => {
                    const p = ICalParser.parseDate({ val: item.trim(), params }, defaultTz);
                    if (p && p.date) exdateSet.add(formatDate(p.date));
                });
            });
        }

        const pad = n => String(n).padStart(2, '0');
        const startHours = origStart.getHours();
        const startMins = origStart.getMinutes();
        const timeStart = baseEvent.isAllDay ? '08:00' : `${pad(startHours)}:${pad(startMins)}`;
        const endTotalMin = startHours * 60 + startMins + durationMinutes;
        const endHours = Math.floor((endTotalMin % (24 * 60)) / 60);
        const endMins = endTotalMin % 60;
        const timeEnd = baseEvent.isAllDay ? '09:00' : `${pad(endHours)}:${pad(endMins)}`;

        let cur = new Date(origStart);
        let occurrences = 0;

        for (let iter = 0; iter < 500 && occurrences < count; iter++) {
            if (untilDate && cur > untilDate) break;
            if (cur > windowEnd) break;

            if (cur >= windowStart) {
                const dateKey = formatDate(cur);
                const dayMatch = !byDays || byDays.some(bd => {
                    const clean = bd.replace(/[^A-Z]/g, '');
                    return dayMap[clean] === cur.getDay();
                });

                if (dayMatch && !exdateSet.has(dateKey)) {
                    events.push({
                        ...baseEvent,
                        id: `remote-${baseEvent.calendarId}-${baseEvent.uid}-${dateKey}`,
                        startDate: new Date(cur),
                        endDate: new Date(cur),
                        timeStart,
                        timeEnd,
                        durationMinutes
                    });
                }
            }

            occurrences++;

            if (freq === 'DAILY') {
                cur.setDate(cur.getDate() + interval);
            } else if (freq === 'WEEKLY') {
                if (byDays && byDays.length > 1) {
                    cur.setDate(cur.getDate() + 1);
                } else {
                    cur.setDate(cur.getDate() + 7 * interval);
                }
            } else if (freq === 'MONTHLY') {
                cur.setMonth(cur.getMonth() + interval);
            } else {
                break;
            }
        }

        return events;
    }
}

// ================================================================
// REMOTE EVENT DETAILS MODAL
// ================================================================

class RemoteEventModal extends obsidian.Modal {
    constructor(app, event, onHide = null) {
        super(app);
        this.event = event;
        this.onHide = onHide;
    }

    onOpen() {
        const { contentEl, event } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper');
        this.modalEl.style.width = '480px';
        this.modalEl.style.maxWidth = '92vw';
        contentEl.addClass('kt-card-edit-modal');
        contentEl.addClass('kt-remote-event-modal');

        // Header with calendar badge
        const topHdr = contentEl.createDiv('kt-re-header');
        const calBadge = topHdr.createSpan('kt-re-cal-badge');
        calBadge.style.backgroundColor = colorMixHex(event.calendarColor || '#3b82f6', 0.15);
        calBadge.style.color = event.calendarColor || '#3b82f6';
        calBadge.style.borderColor = colorMixHex(event.calendarColor || '#3b82f6', 0.35);
        calBadge.setText(`🗓️ ${event.calendarName || 'Google Agenda'}`);

        contentEl.createEl('h2', { cls: 'kt-re-title', text: event.cleanTitle || event.title });
        
        // Time & Date box
        const dateStr = event.startDate ? formatDate(event.startDate) : '';
        const timeBox = contentEl.createDiv('kt-re-time-box');
        timeBox.createSpan({ cls: 'kt-re-time-icon', text: '⏰' });
        timeBox.createSpan({ cls: 'kt-re-time-text', text: `${dateStr} • ${event.timeStart} – ${event.timeEnd}` });

        // Join Video Meeting Button if link exists
        if (event.meetUrl) {
            const joinBtn = contentEl.createEl('a', {
                cls: 'kt-re-join-btn mod-cta',
                text: '🎥 Entrar na Videochamada (Meet / Zoom)',
                href: event.meetUrl
            });
            joinBtn.setAttribute('target', '_blank');
        }

        // Location
        if (event.location) {
            const locBox = contentEl.createDiv('kt-re-info-row');
            locBox.createSpan({ cls: 'kt-re-info-lbl', text: '📍 Local:' });
            locBox.createSpan({ cls: 'kt-re-info-val', text: event.location });
        }

        // Description
        if (event.description) {
            const descBox = contentEl.createDiv('kt-re-desc-box');
            descBox.createEl('h4', { text: 'Descrição / Pauta' });
            const descText = descBox.createDiv('kt-re-desc-content');
            descText.setText(event.description);
        }

        const footer = contentEl.createDiv('kt-modal-footer');
        if (this.onHide) {
            const leftGroup = footer.createDiv('kt-modal-footer-left');
            const hideBtn = leftGroup.createEl('button', {
                cls: 'kt-card-del-btn kt-re-hide-btn',
                text: 'Ocultar evento'
            });
            hideBtn.onclick = async () => {
                this.close();
                await this.onHide();
            };
        }

        const rightGroup = footer.createDiv('kt-modal-footer-right');
        const closeBtn = rightGroup.createEl('button', { text: 'Fechar' });
        closeBtn.onclick = () => this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ================================================================
// REMOTE CALENDAR CONFIG MODAL (Editar / Adicionar Calendário)
// ================================================================

class RemoteCalendarEditModal extends obsidian.Modal {
    constructor(app, calendar, onSave, onDelete) {
        super(app);
        this.calendar = calendar;
        this.onSave = onSave;
        this.onDelete = onDelete;
    }

    onOpen() {
        const { contentEl, calendar } = this;
        this.modalEl.addClass('kt-card-edit-modal-wrapper');
        this.modalEl.style.width = '520px';
        this.modalEl.style.maxWidth = '92vw';
        contentEl.addClass('kt-card-edit-modal');
        contentEl.createEl('h2', { text: calendar ? `Editar Calendário: ${calendar.name}` : 'Novo Calendário Remoto' });

        let name = calendar ? calendar.name : '';
        let color = calendar ? calendar.color : '#3b82f6';
        let url = calendar ? calendar.url : '';
        let email = calendar ? calendar.email : '';
        let enabled = calendar ? calendar.enabled !== false : true;

        new obsidian.Setting(contentEl)
            .setName('Nome / Prefixo do Calendário')
            .setDesc('Identificação do calendário nos blocos de horário (ex: Trabalho, Pessoal, Reuniões)')
            .addText(t => {
                t.setPlaceholder('ex: Trabalho').setValue(name).onChange(v => name = v.trim());
            });

        new obsidian.Setting(contentEl)
            .setName('Cor de Destaque')
            .setDesc('Cor dos blocos de reunião no Timeblocking')
            .addColorPicker(cp => {
                cp.setValue(color).onChange(v => color = v);
            });

        new obsidian.Setting(contentEl)
            .setName('URL do Calendário Remoto (.ics)')
            .setDesc('Cole o link iCal do Google Agenda, Outlook ou Apple Calendar (URL terminando em .ics ou webcal://)')
            .addText(t => {
                t.setPlaceholder('https://calendar.google.com/calendar/ical/.../basic.ics')
                    .setValue(url)
                    .onChange(v => url = v.trim());
                t.inputEl.style.width = '360px';
            });

        new obsidian.Setting(contentEl)
            .setName('Seu E-mail (Opcional)')
            .setDesc('Usado para identificar seu status de presença nas reuniões (Aceito / Recusado)')
            .addText(t => {
                t.setPlaceholder('ex: usuario@email.com').setValue(email).onChange(v => email = v.trim());
            });

        // Test connection button
        new obsidian.Setting(contentEl)
            .setName('Testar Conexão')
            .setDesc('Verifique se a URL fornecida é acessível e contém eventos válidos.')
            .addButton(b => {
                b.setButtonText('Testar URL').onClick(async () => {
                    if (!url) {
                        new obsidian.Notice('Por favor, informe a URL do calendário primeiro.');
                        return;
                    }
                    b.setButtonText('Baixando...');
                    b.setDisabled(true);
                    try {
                        let cleanUrl = url.trim();
                        if (cleanUrl.startsWith('webcal://')) cleanUrl = 'https://' + cleanUrl.slice(9);
                        const res = await obsidian.requestUrl({ url: cleanUrl });
                        const parsed = ICalParser.parse(res.text, { id: 'test', name, color });
                        b.setButtonText('Testar URL');
                        b.setDisabled(false);
                        new obsidian.Notice(`✓ Conexão bem-sucedida! Encontrados ${parsed.length} eventos no feed.`);
                    } catch (err) {
                        b.setButtonText('Testar URL');
                        b.setDisabled(false);
                        new obsidian.Notice(`❌ Falha ao conectar: ${err.message || 'Verifique a URL'}`);
                    }
                });
            });

        const footer = contentEl.createDiv('kt-modal-footer');
        const leftGroup = footer.createDiv('kt-modal-footer-left');
        if (calendar && this.onDelete) {
            const deleteBtn = leftGroup.createEl('button', { cls: 'mod-warning', text: 'Excluir Calendário' });
            deleteBtn.onclick = () => {
                this.close();
                this.onDelete();
            };
        }

        const rightGroup = footer.createDiv('kt-modal-footer-right');
        const cancelBtn = rightGroup.createEl('button', { text: 'Cancelar' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightGroup.createEl('button', { cls: 'mod-cta', text: 'Salvar Calendário' });
        saveBtn.onclick = async () => {
            if (!url) {
                new obsidian.Notice('Por favor, informe a URL (.ics) do calendário.');
                return;
            }
            this.close();
            const calData = {
                id: calendar ? calendar.id : 'cal-' + Date.now(),
                name: name || 'Google Calendar',
                color,
                url,
                email,
                enabled
            };
            if (this.onSave) await this.onSave(calData);
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ================================================================
// SETTINGS TAB
// ================================================================

class KanbanTimelineSettingsTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: '⚙️ Kanban Timeline – Configurações' });

        new obsidian.Setting(containerEl)
            .setName('Arquivo do Kanban')
            .setDesc('Caminho relativo ao vault para o arquivo .md do seu Kanban Board.')
            .addText(t => {
                t.setValue(this.plugin.settings.kanbanFile)
                    .setPlaceholder('Kanban.md')
                    .onChange(async v => {
                        this.plugin.settings.kanbanFile = v.trim();
                        await this.plugin.saveSettings();
                    });
                t.inputEl.style.width = '380px';
            });

        new obsidian.Setting(containerEl)
            .setName('Hora de início da grade')
            .setDesc('Primeira hora exibida no Timeblocking (padrão: 7)')
            .addSlider(s => s.setLimits(5, 12, 1).setValue(this.plugin.settings.dayStart)
                .onChange(async v => {
                    this.plugin.settings.dayStart = v;
                    await this.plugin.saveSettings();
                }).setDynamicTooltip());

        new obsidian.Setting(containerEl)
            .setName('Hora de fim da grade')
            .setDesc('Última hora exibida no Timeblocking (padrão: 22)')
            .addSlider(s => s.setLimits(18, 24, 1).setValue(this.plugin.settings.dayEnd)
                .onChange(async v => {
                    this.plugin.settings.dayEnd = v;
                    await this.plugin.saveSettings();
                }).setDynamicTooltip());

        new obsidian.Setting(containerEl)
            .setName('Período padrão do Cronograma')
            .setDesc('Número de dias exibidos no Cronograma (Gantt)')
            .addDropdown(d => {
                d.addOption('14', '14 dias (2 Semanas)');
                d.addOption('21', '21 dias (3 Semanas)');
                d.addOption('28', '28 dias (4 Semanas / Mês)');
                d.addOption('auto', 'Automático (Preencher tela inteira)');
                d.setValue(this.plugin.settings.ganttDaysMode || '14');
                d.onChange(async v => {
                    this.plugin.settings.ganttDaysMode = v;
                    await this.plugin.saveSettings();
                });
            });

        new obsidian.Setting(containerEl)
            .setName('Mover tarefas de Hoje para In Development')
            .setDesc('Move automaticamente cards que abrangem a data de hoje para a coluna InDevelopment no Kanban.')
            .addToggle(t => {
                t.setValue(this.plugin.settings.autoMoveTodayToInDev !== false)
                    .onChange(async v => {
                        this.plugin.settings.autoMoveTodayToInDev = v;
                        await this.plugin.saveSettings();
                    });
            });

        // Section: Remote Calendars (Google Agenda / iCal)
        containerEl.createEl('h3', { text: '🗓️ Calendários Remotos (Google Agenda / iCal)' });
        containerEl.createEl('p', {
            cls: 'setting-item-description',
            text: 'Sincronize reuniões e eventos do Google Agenda, Outlook ou Apple Calendar (.ics) diretamente nos blocos de horário do Timeblocking.'
        });

        const calListContainer = containerEl.createDiv('kt-remote-cals-list');
        const remoteCals = this.plugin.settings.remoteCalendars || [];

        const renderCalList = () => {
            calListContainer.empty();
            if (remoteCals.length === 0) {
                const emptyEl = calListContainer.createDiv('kt-settings-empty-notice');
                emptyEl.setText('Nenhum calendário remoto cadastrado. Clique no botão abaixo para adicionar.');
                return;
            }

            remoteCals.forEach((cal, idx) => {
                const s = new obsidian.Setting(calListContainer)
                    .setName(cal.name || `Calendário ${idx + 1}`)
                    .setDesc(cal.url ? (cal.url.length > 55 ? cal.url.slice(0, 52) + '...' : cal.url) : 'Sem URL configurada');

                const nameEl = s.nameEl;
                const dot = createSpan({ cls: 'kt-proj-color-dot' });
                dot.style.backgroundColor = cal.color || '#3b82f6';
                dot.style.display = 'inline-block';
                dot.style.marginRight = '8px';
                nameEl.prepend(dot);

                s.addToggle(t => {
                    t.setValue(cal.enabled !== false)
                        .setTooltip(cal.enabled !== false ? 'Desativar este calendário' : 'Ativar este calendário')
                        .onChange(async v => {
                            cal.enabled = v;
                            await this.plugin.saveSettings();
                            await this.plugin.syncAllRemoteCalendars();
                        });
                });

                s.addButton(b => {
                    b.setIcon('pencil')
                        .setTooltip('Editar Calendário')
                        .onClick(() => {
                            new RemoteCalendarEditModal(this.app, cal, async (updated) => {
                                remoteCals[idx] = updated;
                                this.plugin.settings.remoteCalendars = remoteCals;
                                await this.plugin.saveSettings();
                                renderCalList();
                                await this.plugin.syncAllRemoteCalendars();
                            }, async () => {
                                remoteCals.splice(idx, 1);
                                this.plugin.settings.remoteCalendars = remoteCals;
                                await this.plugin.saveSettings();
                                renderCalList();
                                await this.plugin.syncAllRemoteCalendars();
                            }).open();
                        });
                });

                s.addButton(b => {
                    b.setIcon('trash')
                        .setWarning()
                        .setTooltip('Excluir Calendário')
                        .onClick(async () => {
                            remoteCals.splice(idx, 1);
                            this.plugin.settings.remoteCalendars = remoteCals;
                            await this.plugin.saveSettings();
                            renderCalList();
                            await this.plugin.syncAllRemoteCalendars();
                            new obsidian.Notice(`Calendário removido.`);
                        });
                });
            });
        };

        renderCalList();

        new obsidian.Setting(containerEl)
            .addButton(b => {
                b.setButtonText('＋ Adicionar Calendário Remoto')
                    .setCta()
                    .onClick(() => {
                        new RemoteCalendarEditModal(this.app, null, async (newCal) => {
                            if (!this.plugin.settings.remoteCalendars) this.plugin.settings.remoteCalendars = [];
                            this.plugin.settings.remoteCalendars.push(newCal);
                            await this.plugin.saveSettings();
                            renderCalList();
                            await this.plugin.syncAllRemoteCalendars();
                            new obsidian.Notice(`Calendário "${newCal.name}" adicionado!`);
                        }).open();
                    });
            })
            .addButton(b => {
                b.setButtonText('🔄 Sincronizar Agora')
                    .onClick(async () => {
                        b.setButtonText('Sincronizando...');
                        b.setDisabled(true);
                        const count = await this.plugin.syncAllRemoteCalendars(true);
                        b.setButtonText('🔄 Sincronizar Agora');
                        b.setDisabled(false);
                        new obsidian.Notice(`✓ Sincronização concluída: ${count} eventos encontrados.`);
                    });
            });

        if (this.plugin.settings.hiddenRemoteEvents && this.plugin.settings.hiddenRemoteEvents.length > 0) {
            const hiddenCount = this.plugin.settings.hiddenRemoteEvents.length;
            new obsidian.Setting(containerEl)
                .setName('Eventos do Google Agenda Ocultados')
                .setDesc(`${hiddenCount} evento(s) ou série(s) ocultados manualmente via botão direito no Timeblocking.`)
                .addButton(b => {
                    b.setButtonText('Reexibir Todos os Eventos Ocultos')
                        .onClick(async () => {
                            this.plugin.settings.hiddenRemoteEvents = [];
                            await this.plugin.saveSettings();
                            new obsidian.Notice('Todos os eventos do Google Agenda foram reexibidos!');
                            this.display();
                            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
                            leaves.forEach(leaf => {
                                if (leaf.view && typeof leaf.view.render === 'function') {
                                    leaf.view.render();
                                }
                            });
                        });
                });
        }

        // Section: Cores das Colunas
        containerEl.createEl('h3', { text: '🎨 Cores das Colunas do Kanban' });
        containerEl.createEl('p', {
            cls: 'setting-item-description',
            text: 'Defina a cor de cada coluna. Cards sem tag de projeto específica herdam a cor da sua coluna no Cronograma e no Timeblocking.'
        });

        const detectedCols = this.plugin.lastDetectedColumns || Object.keys(this.plugin.settings.columnColors || {});
        const uniqueCols = Array.from(new Set([...detectedCols, ...Object.keys(this.plugin.settings.columnColors || {})]));

        uniqueCols.forEach(col => {
            if (isIgnoredColumn(col)) return;
            const curCol = this.plugin.settings.columnColors?.[col] || getProjectColor([], col, this.plugin.settings.columnColors);
            new obsidian.Setting(containerEl)
                .setName(col)
                .addColorPicker(cp => {
                    cp.setValue(curCol).onChange(async v => {
                        if (!this.plugin.settings.columnColors) this.plugin.settings.columnColors = {};
                        this.plugin.settings.columnColors[col] = v;
                        await this.plugin.saveSettings();
                    });
                });
        });

        // Section: Hidden Columns
        const hiddenCols = this.plugin.settings.hiddenColumns || [];
        containerEl.createEl('h3', { text: 'Colunas Ocultas' });
        if (hiddenCols.length === 0) {
            containerEl.createEl('p', {
                cls: 'setting-item-description',
                text: 'Nenhuma coluna está oculta. Para ocultar colunas, use o botão "Ocultar Colunas" na aba Kanban.'
            });
        } else {
            containerEl.createEl('p', {
                cls: 'setting-item-description',
                text: 'Colunas ocultas não aparecem na aba Kanban. Clique em "Mostrar" para restaurá-las.'
            });
            hiddenCols.forEach(col => {
                new obsidian.Setting(containerEl)
                    .setName(col)
                    .setDesc(`Coluna "${col}" está oculta`)
                    .addButton(b => {
                        b.setButtonText('Mostrar')
                            .setCta()
                            .onClick(async () => {
                                this.plugin.settings.hiddenColumns = (this.plugin.settings.hiddenColumns || []).filter(c => c !== col);
                                await this.plugin.saveSettings();
                                new obsidian.Notice(`Coluna "${col}" restaurada`);
                                this.display(); // Re-render settings tab
                            });
                    });
            });
            new obsidian.Setting(containerEl)
                .addButton(b => {
                    b.setButtonText('Mostrar Todas as Colunas')
                        .onClick(async () => {
                            this.plugin.settings.hiddenColumns = [];
                            await this.plugin.saveSettings();
                            new obsidian.Notice('Todas as colunas restauradas');
                            this.display();
                        });
                });
        }
    }
}

// ================================================================
// MAIN VIEW
// ================================================================

class KanbanTimelineView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin          = plugin;
        this.parser          = new KanbanParser();
        this.cards           = [];
        this.columns         = [];
        this.viewMode        = 'gantt';   // 'gantt' | 'timeblock'
        this.weekOffset      = 0;
        this.selectedDay     = null;
        this.backlogCollapsed = this.plugin.settings.backlogCollapsed || false;
        this.backlogHeight    = this.plugin.settings.backlogHeight || 300;
        this.editingCardLineIndex = null;
        this.awPeriodFilter = 'today';
        this.awSelectedDate = new Date();
        this.awData = null;
        this.awExpandedWindows = false;
        this.awExpandedCategories = false;
    }

    getViewType()    { return VIEW_TYPE; }
    getDisplayText() { return 'Kanban Timeline'; }
    getIcon()        { return 'calendar-days'; }

    async onOpen() {
        this.containerEl.addClass('kanban-timeline-root');
        await this.refresh();

        // Live update when kanban file changes
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (file.path === this.plugin.settings.kanbanFile) {
                    await this.refresh();
                }
            })
        );

        // Live clock update every 60s for the Timeblocking now indicator
        this.registerInterval(
            window.setInterval(() => {
                if (this.viewMode === 'timeblock') {
                    const now = new Date();
                    const day = this.selectedDay || now;
                    if (sameDay(day, now)) {
                        this.render();
                    }
                }
            }, 60000)
        );
    }

    async onClose() {}

    async refresh() {
        await this.loadCards();
        if (this.plugin.settings.awConnected) {
            await this.loadActivityWatchData();
        }
        this.render();
    }

    async loadCards() {
        const path = this.plugin.settings.kanbanFile;
        let file   = this.app.vault.getAbstractFileByPath(path);

        // Auto-detect if path not found
        if (!file || !(file instanceof obsidian.TFile)) {
            const candidates = this.app.vault.getFiles()
                .filter(f => f.extension === 'md' && f.path.toLowerCase().includes('kanban'));
            if (candidates.length > 0) {
                file = candidates[0];
                this.plugin.settings.kanbanFile = file.path;
                await this.plugin.saveSettings();
            }
        }

        // Auto-initialize default Kanban.md if not found anywhere in vault
        if (!file || !(file instanceof obsidian.TFile)) {
            const todayStr = formatDate(new Date());
            const filePath = path || 'Kanban.md';
            const defaultContent = `---

kanban-plugin: basic

---

## Backlog

- [ ] Planejar metas da semana #Geral @{${todayStr}} ~1h
- [ ] Explorar recursos do plugin Kanban Timeline

## InDevelopment

- [ ] Minha primeira tarefa @{${todayStr}} ⏰ 09:00-10:30

## Done

- [x] Instalar o plugin Kanban Timeline

## Archive

## Rotina

- [ ] Planejamento Diário <!-- type:rotina ⏰ 08:30-09:00 -->
`;
            try {
                file = await this.app.vault.create(filePath, defaultContent);
                this.plugin.settings.kanbanFile = file.path;
                await this.plugin.saveSettings();
                new obsidian.Notice('✨ Quadro "Kanban.md" inicializado automaticamente com sucesso!');
            } catch (err) {
                console.error('[Kanban Timeline] Erro ao criar arquivo inicial:', err);
                this.cards   = [];
                this.columns = [];
                return;
            }
        }

        let content = await this.app.vault.read(file);

        // Auto move today cards to InDevelopment ONLY if explicitly enabled
        if (this.plugin.settings.autoMoveTodayToInDev === true) {
            const syncRes = this.syncTodayCards(content, this.plugin.settings.columnColors, this.plugin.settings.projects);
            if (syncRes.modified) {
                content = syncRes.content;
                await this.app.vault.modify(file, content);
            }
        }

        const parsed     = this.parser.parse(content, this.plugin.settings.columnColors, this.plugin.settings.projects);
        this.cards       = parsed.cards;
        this.columns     = parsed.columns;
        this.plugin.lastDetectedColumns = this.columns;
    }

    syncTodayCards(content, columnColors, customProjects = []) {
        let currentContent = content;
        let parsed = this.parser.parse(currentContent, columnColors, customProjects);
        const today = startOfDay(new Date());
        let modified = false;

        for (const card of parsed.cards) {
            if (card.isCompleted || card.isEvent || card.column === 'Rotina' || isIgnoredColumn(card.column)) continue;
            if (!card.startDate) continue;

            const s = startOfDay(card.startDate);
            const e = endOfDay(card.endDate || card.startDate);

            // If active today
            if (today >= s && today <= e) {
                const colClean = card.column.trim().toLowerCase().replace(/[\s-_]+/g, '');
                if (colClean !== 'indevelopment') {
                    currentContent = this.parser.moveCardToColumn(currentContent, card.lineIndex, 'InDevelopment');
                    modified = true;
                    // Re-parse to maintain valid line indices for subsequent iterations
                    parsed = this.parser.parse(currentContent, columnColors, customProjects);
                }
            }
        }

        return { content: currentContent, modified };
    }

    async persistDateRange(card, start, end) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        const content = await this.app.vault.read(file);
        const updated = this.parser.updateDateRange(content, card.lineIndex, start, end);
        await this.app.vault.modify(file, updated);
        new obsidian.Notice(`${card.title} → ${formatDate(start)}${sameDay(start, end) ? '' : ' – ' + formatDate(end)}`);
    }

    async persistTimeBlock(card, date, ts, te) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        const content = await this.app.vault.read(file);
        const targetDate = date || this.selectedDay || card.startDate || new Date();
        const updated = this.parser.updateTimeBlock(content, card.lineIndex, targetDate, ts, te);
        await this.app.vault.modify(file, updated);
        if (ts && te) {
            new obsidian.Notice(`${card.title} (${formatDate(targetDate).slice(0,5)}) → ${ts} – ${te}`);
        } else {
            new obsidian.Notice(`Horário removido de ${card.title}`);
        }
    }

    async createTimeEvent(title, date, h, m, durationMins, eventType) {
        const startMin = h * 60 + m;
        const endMin   = Math.min(23 * 60 + 59, startMin + durationMins);
        const ts       = minutesToTime(startMin);
        const te       = minutesToTime(endMin);
        await this.createCustomTimeEvent(title, date, ts, te, eventType, 'none');
    }

    async createCustomTimeEvent(title, date, ts, te, eventType, repeatRule = 'none', customDays = [], repeatWeeks = 4) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;

        const items = [];
        const baseDate = startOfDay(date);

        if (repeatRule === 'none') {
            items.push({ title, date: baseDate, timeStart: ts, timeEnd: te, eventType });
        } else {
            const seriesId = 'series_' + Date.now();
            const totalDays = repeatWeeks * 7;

            for (let i = 0; i < totalDays; i++) {
                const curDate = new Date(baseDate);
                curDate.setDate(curDate.getDate() + i);
                const dow = curDate.getDay();

                let shouldAdd = false;
                if (repeatRule === 'daily') {
                    shouldAdd = true;
                } else if (repeatRule === 'weekdays') {
                    shouldAdd = (dow >= 1 && dow <= 5);
                } else if (repeatRule === 'weekly') {
                    shouldAdd = (dow === baseDate.getDay());
                } else if (repeatRule === 'custom') {
                    shouldAdd = customDays.includes(dow);
                }

                if (shouldAdd) {
                    items.push({
                        title,
                        date: curDate,
                        timeStart: ts,
                        timeEnd: te,
                        eventType,
                        seriesId
                    });
                }
            }
        }

        let content = await this.app.vault.read(file);
        content = this.parser.addTimeEventsBatch(content, items);
        await this.app.vault.modify(file, content);

        if (items.length > 1) {
            new obsidian.Notice(`✓ Criados ${items.length} blocos recorrentes para "${title}" (${ts} – ${te})`);
        } else {
            new obsidian.Notice(`✓ ${title} adicionado (${ts} – ${te})`);
        }
        await this.refresh();
    }

    async updateTimeEventSeries(card, day, newTitle, newTs, newTe, applyToAll = false) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);

        if (!applyToAll) {
            content = this.parser.updateTimeBlock(content, card.lineIndex, day, newTs, newTe);
            if (newTitle && newTitle !== card.title) {
                content = this.parser.saveCardEdit(content, card.lineIndex, newTitle, card.column, card.column, card.startDate, card.endDate);
            }
        } else {
            content = this.parser.updateTimeEventSeries(content, card.seriesId, card.title, newTitle, newTs, newTe, card.eventType, day);
        }

        await this.app.vault.modify(file, content);
        new obsidian.Notice('Evento(s) atualizado(s)');
        await this.refresh();
    }

    async deleteTimeEventSeries(card, day, deleteAll = false) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);

        if (!deleteAll) {
            content = this.parser.deleteCard(content, card.lineIndex);
        } else {
            content = this.parser.deleteTimeEventSeries(content, card.seriesId, card.title, day);
        }

        await this.app.vault.modify(file, content);
        new obsidian.Notice(deleteAll ? `Série "${card.title}" excluída` : `Evento excluído`);
        await this.refresh();
    }

    async deleteCardLine(lineIndex) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        const content = await this.app.vault.read(file);
        const updated = this.parser.deleteCard(content, lineIndex);
        await this.app.vault.modify(file, updated);
        new obsidian.Notice('Card excluído');
    }

    async removeCardFromSchedule(card) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        const content = await this.app.vault.read(file);
        const updated = this.parser.removeDateRange(content, card.lineIndex);
        await this.app.vault.modify(file, updated);
        new obsidian.Notice(`${card.title} removido do cronograma`);
        await this.refresh();
    }

    async toggleSubtaskCompletion(subtaskLineIndex) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);
        content = this.parser.toggleSubtaskCompletion(content, subtaskLineIndex);
        await this.app.vault.modify(file, content);
    }

    async openCardOptionsModal(card, targetDay = null) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        let initialText = card.title;
        if (file) {
            try {
                const content = await this.app.vault.read(file);
                initialText = this.parser.getCardEditableText(content, card.lineIndex) || card.title;
            } catch (e) {
                console.error('[Kanban Timeline] Erro ao ler texto do card:', e);
            }
        }

        const activeDay = targetDay || this.selectedDay || new Date();
        const dayTime = getTimeForDay(card, activeDay);

        new CardOptionsModal(
            this.app,
            this.plugin,
            card,
            this.columns,
            initialText,
            async (targetColumn, origColumn, sDate, eDate, tsVal, teVal, updatedText) => {
                if (!file) return;
                let content = await this.app.vault.read(file);
                const textVal = updatedText || initialText;
                content = this.parser.saveCardEdit(content, card.lineIndex, textVal, targetColumn, origColumn, sDate, eDate);

                // If Timeblocking hours were modified or set:
                const parsedSDate = parseDate(sDate);
                const blockDay = targetDay || (card.startDate ? activeDay : (parsedSDate || new Date()));
                if (tsVal || teVal) {
                    content = this.parser.updateTimeBlock(content, card.lineIndex, blockDay, tsVal, teVal);
                }

                await this.app.vault.modify(file, content);
                new obsidian.Notice('Card atualizado');
                await this.refresh();
            },
            async () => {
                await this.deleteCardLine(card.lineIndex);
                await this.refresh();
            },
            dayTime
        ).open();
    }

    startInlineCardEdit(card) {
        this.editingCardLineIndex = card.lineIndex;
        this.render();
    }

    async renderInlineCardEditor(cardEl, card) {
        cardEl.addClass('kt-card-is-editing');
        cardEl.removeAttribute('draggable');

        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        let textVal = card.title;
        if (file) {
            try {
                const content = await this.app.vault.read(file);
                const extracted = this.parser.getCardEditableText(content, card.lineIndex);
                if (extracted) textVal = extracted;
            } catch (e) {
                console.error('[Kanban Timeline] Error reading card text:', e);
            }
        }

        const textarea = cardEl.createEl('textarea', {
            cls: 'kt-inline-card-textarea',
            attr: {
                placeholder: 'Conteúdo do card (Markdown)...'
            }
        });
        textarea.value = textVal;
        new CardTextareaSuggester(this.app, textarea, () => this.cards.flatMap(c => c.tags));

        const autoResize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.max(48, textarea.scrollHeight)}px`;
        };

        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            autoResize();
        }, 20);

        textarea.addEventListener('input', autoResize);

        let isSaving = false;
        const saveInline = async () => {
            if (isSaving) return;
            isSaving = true;
            const newText = textarea.value.trim();
            this.editingCardLineIndex = null;
            if (newText && newText !== textVal) {
                const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
                if (file) {
                    let content = await this.app.vault.read(file);
                    content = this.parser.saveCardEdit(content, card.lineIndex, newText, card.column, card.column, card.startDate, card.endDate);
                    await this.app.vault.modify(file, content);
                }
            }
            await this.refresh();
        };

        const cancelInline = async () => {
            this.editingCardLineIndex = null;
            await this.refresh();
        };

        textarea.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                await saveInline();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                await cancelInline();
            }
        });

        textarea.addEventListener('blur', async () => {
            await saveInline();
        });
    }

    openDateRangeModal(card) {
        const modal = new DateRangeModal(
            this.app,
            card,
            async (s, e) => {
                await this.persistDateRange(card, s, e);
                await this.refresh();
            },
            async () => {
                await this.removeCardFromSchedule(card);
            },
            async () => {
                await this.deleteCardLine(card.lineIndex);
                await this.refresh();
            }
        );
        modal.onEditContent = () => this.openCardOptionsModal(card);
        modal.open();
    }

    // ----------------------------------------------------------
    // DOCKING & SPLIT LAYOUT MANAGER (Unity / Blender Style)
    // ----------------------------------------------------------

    getDockLayout() {
        if (this.plugin.settings.dockLayout && typeof this.plugin.settings.dockLayout === 'object') {
            return this.plugin.settings.dockLayout;
        }
        return {
            id: 'pane-root',
            type: 'pane',
            tabs: [this.viewMode || 'gantt'],
            activeTab: this.viewMode || 'gantt'
        };
    }

    async saveDockLayout(layout) {
        if (layout) {
            this.plugin.settings.dockLayout = layout;
        }
        await this.plugin.saveSettings();
    }

    findDockNode(node, id) {
        if (!node || !id) return null;
        if (node.id === id) return node;
        if (node.type === 'split') {
            return this.findDockNode(node.first, id) || this.findDockNode(node.second, id);
        }
        return null;
    }

    findDockParent(node, childId) {
        if (!node || node.type !== 'split') return null;
        if (node.first?.id === childId) return { parent: node, which: 'first' };
        if (node.second?.id === childId) return { parent: node, which: 'second' };
        return this.findDockParent(node.first, childId) || this.findDockParent(node.second, childId);
    }

    getAllDockPanes(node) {
        if (!node) return [];
        if (node.type === 'pane') return [node];
        if (node.type === 'split') {
            return [...this.getAllDockPanes(node.first), ...this.getAllDockPanes(node.second)];
        }
        return [];
    }

    hasActiveDockView(viewKey) {
        const layout = this.getDockLayout();
        const allPanes = this.getAllDockPanes(layout);
        if (!allPanes || allPanes.length === 0) return this.viewMode === viewKey;
        return allPanes.some(p => (p.activeTab || p.tabs?.[0]) === viewKey);
    }

    splitDockPane(targetPaneId, direction, newViewMode = null) {
        const layout = this.getDockLayout();
        const target = this.findDockNode(layout, targetPaneId);
        if (!target || target.type !== 'pane') return;

        const currentActive = target.activeTab || target.tabs?.[0] || 'gantt';
        const nextView = newViewMode || (currentActive === 'timeblock' ? 'gantt' : 'timeblock');

        const newPane = {
            id: 'pane-' + Math.random().toString(36).substr(2, 8),
            type: 'pane',
            tabs: [nextView],
            activeTab: nextView
        };

        const oldTargetCopy = { ...target };

        target.type = 'split';
        target.direction = direction; // 'row' or 'column'
        target.splitPercent = 50;
        target.first = oldTargetCopy;
        target.second = newPane;
        delete target.tabs;
        delete target.activeTab;

        this.maximizedPaneId = null;
        this.saveDockLayout(layout);
        this.render();
    }

    closeDockPane(paneId) {
        const layout = this.getDockLayout();
        const parentInfo = this.findDockParent(layout, paneId);
        if (!parentInfo) {
            // Root pane cannot be closed, reset to single tab
            const pane = this.findDockNode(layout, paneId);
            if (pane) {
                pane.tabs = ['gantt'];
                pane.activeTab = 'gantt';
                this.saveDockLayout(layout);
                this.render();
            }
            return;
        }

        const { parent, which } = parentInfo;
        const sibling = which === 'first' ? parent.second : parent.first;

        // Replace parent with sibling
        Object.keys(parent).forEach(k => delete parent[k]);
        Object.assign(parent, sibling);

        this.maximizedPaneId = null;
        this.saveDockLayout(layout);
        this.render();
    }

    moveDockTab(fromPaneId, toPaneId, tabId, dropPos = 'center') {
        const layout = this.getDockLayout();
        const toPane = this.findDockNode(layout, toPaneId);
        if (!toPane || toPane.type !== 'pane') return;

        // 1. Remove from source pane if exists
        if (fromPaneId) {
            const fromPane = this.findDockNode(layout, fromPaneId);
            if (fromPane && fromPane.type === 'pane') {
                fromPane.tabs = (fromPane.tabs || []).filter(t => t !== tabId);
                if (fromPane.activeTab === tabId) {
                    fromPane.activeTab = fromPane.tabs[0] || 'gantt';
                }
                if (fromPane.tabs.length === 0) {
                    this.closeDockPane(fromPaneId);
                }
            }
        }

        // 2. Add to destination
        if (dropPos === 'center') {
            if (!toPane.tabs) toPane.tabs = [];
            if (!toPane.tabs.includes(tabId)) {
                toPane.tabs.push(tabId);
            }
            toPane.activeTab = tabId;
        } else if (dropPos === 'left' || dropPos === 'right') {
            const newPane = {
                id: 'pane-' + Math.random().toString(36).substr(2, 8),
                type: 'pane',
                tabs: [tabId],
                activeTab: tabId
            };
            const oldToPaneCopy = { ...toPane };
            toPane.type = 'split';
            toPane.direction = 'row';
            toPane.splitPercent = 50;
            toPane.first = dropPos === 'left' ? newPane : oldToPaneCopy;
            toPane.second = dropPos === 'left' ? oldToPaneCopy : newPane;
            delete toPane.tabs;
            delete toPane.activeTab;
        } else if (dropPos === 'top' || dropPos === 'bottom') {
            const newPane = {
                id: 'pane-' + Math.random().toString(36).substr(2, 8),
                type: 'pane',
                tabs: [tabId],
                activeTab: tabId
            };
            const oldToPaneCopy = { ...toPane };
            toPane.type = 'split';
            toPane.direction = 'column';
            toPane.splitPercent = 50;
            toPane.first = dropPos === 'top' ? newPane : oldToPaneCopy;
            toPane.second = dropPos === 'top' ? oldToPaneCopy : newPane;
            delete toPane.tabs;
            delete toPane.activeTab;
        }

        this.maximizedPaneId = null;
        this.saveDockLayout(layout);
        this.render();
    }

    applyDockPreset(presetKey) {
        let layout = null;
        if (presetKey === 'single') {
            layout = {
                id: 'pane-root',
                type: 'pane',
                tabs: [this.viewMode || 'gantt'],
                activeTab: this.viewMode || 'gantt'
            };
        } else if (presetKey === 'tb-gantt-h') {
            layout = {
                id: 'split-root',
                type: 'split',
                direction: 'row',
                splitPercent: 40,
                first: { id: 'pane-tb', type: 'pane', tabs: ['timeblock'], activeTab: 'timeblock' },
                second: { id: 'pane-gantt', type: 'pane', tabs: ['gantt'], activeTab: 'gantt' }
            };
        } else if (presetKey === 'gantt-tb-v') {
            layout = {
                id: 'split-root',
                type: 'split',
                direction: 'column',
                splitPercent: 55,
                first: { id: 'pane-gantt', type: 'pane', tabs: ['gantt'], activeTab: 'gantt' },
                second: { id: 'pane-tb', type: 'pane', tabs: ['timeblock'], activeTab: 'timeblock' }
            };
        } else if (presetKey === 'tb-kanban-h') {
            layout = {
                id: 'split-root',
                type: 'split',
                direction: 'row',
                splitPercent: 45,
                first: { id: 'pane-tb', type: 'pane', tabs: ['timeblock'], activeTab: 'timeblock' },
                second: { id: 'pane-kanban', type: 'pane', tabs: ['kanban'], activeTab: 'kanban' }
            };
        } else if (presetKey === 'gantt-kanban-v') {
            layout = {
                id: 'split-root',
                type: 'split',
                direction: 'column',
                splitPercent: 50,
                first: { id: 'pane-gantt', type: 'pane', tabs: ['gantt'], activeTab: 'gantt' },
                second: { id: 'pane-kanban', type: 'pane', tabs: ['kanban'], activeTab: 'kanban' }
            };
        } else if (presetKey === 'triple') {
            layout = {
                id: 'split-root',
                type: 'split',
                direction: 'row',
                splitPercent: 38,
                first: { id: 'pane-tb', type: 'pane', tabs: ['timeblock'], activeTab: 'timeblock' },
                second: {
                    id: 'split-right',
                    type: 'split',
                    direction: 'column',
                    splitPercent: 55,
                    first: { id: 'pane-gantt', type: 'pane', tabs: ['gantt'], activeTab: 'gantt' },
                    second: { id: 'pane-kanban', type: 'pane', tabs: ['kanban'], activeTab: 'kanban' }
                }
            };
        }

        if (layout) {
            this.maximizedPaneId = null;
            this.saveDockLayout(layout);
            this.render();
        }
    }

    renderDockLayout(container) {
        const layout = this.getDockLayout();
        const wrap = container.createDiv('kt-dock-container');

        if (this.maximizedPaneId) {
            const maxPane = this.findDockNode(layout, this.maximizedPaneId);
            if (maxPane && maxPane.type === 'pane') {
                this.renderDockPane(wrap, maxPane, true);
                return;
            }
            this.maximizedPaneId = null;
        }

        this.renderDockNode(wrap, layout);
    }

    renderDockNode(container, node) {
        if (!node) return;

        if (node.type === 'split') {
            const splitEl = container.createDiv(`kt-dock-split kt-dock-${node.direction}`);
            
            // First Child
            const firstWrap = splitEl.createDiv('kt-dock-split-item');
            const pct = Math.max(10, Math.min(90, node.splitPercent || 50));
            firstWrap.style.flex = `0 0 ${pct}%`;
            firstWrap.style.overflow = 'hidden';
            firstWrap.style.display = 'flex';
            firstWrap.style.minWidth = '0';
            firstWrap.style.minHeight = '0';
            this.renderDockNode(firstWrap, node.first);

            // Resizer Divider
            const resizer = splitEl.createDiv(`kt-dock-resizer kt-dock-resizer-${node.direction}`);
            this.attachDockResizer(resizer, node, firstWrap, splitEl);

            // Second Child
            const secondWrap = splitEl.createDiv('kt-dock-split-item');
            secondWrap.style.flex = '1 1 0px';
            secondWrap.style.overflow = 'hidden';
            secondWrap.style.display = 'flex';
            secondWrap.style.minWidth = '0';
            secondWrap.style.minHeight = '0';
            this.renderDockNode(secondWrap, node.second);

        } else if (node.type === 'pane') {
            this.renderDockPane(container, node, false);
        }
    }

    attachDockResizer(resizerEl, splitNode, firstWrapEl, splitContainerEl) {
        resizerEl.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const isRow = splitNode.direction === 'row';
            const rect = splitContainerEl.getBoundingClientRect();
            const totalSize = isRow ? rect.width : rect.height;
            const startCoord = isRow ? rect.left : rect.top;

            resizerEl.classList.add('is-dragging');
            document.body.classList.add('kt-is-tb-resizing');

            const onPointerMove = (moveEvt) => {
                const currentCoord = isRow ? moveEvt.clientX : moveEvt.clientY;
                const offset = currentCoord - startCoord;
                let newPct = (offset / totalSize) * 100;
                newPct = Math.max(10, Math.min(90, Math.round(newPct)));

                splitNode.splitPercent = newPct;
                firstWrapEl.style.flex = `0 0 ${newPct}%`;
            };

            const onPointerUp = async () => {
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                resizerEl.classList.remove('is-dragging');
                document.body.classList.remove('kt-is-tb-resizing');
                await this.saveDockLayout();
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });
    }

    renderDockPane(container, paneNode, isMaximized = false) {
        const paneEl = container.createDiv('kt-dock-pane');
        paneEl.dataset.paneId = paneNode.id;

        const allPanes = this.getAllDockPanes(this.getDockLayout());
        const showMultiControls = allPanes.length > 1;

        // 1. Pane Header
        const header = paneEl.createDiv('kt-dock-pane-header');

        // Tab bar
        const tabbar = header.createDiv('kt-dock-tabbar');
        const tabs = paneNode.tabs && paneNode.tabs.length > 0 ? paneNode.tabs : ['gantt'];
        const activeTab = paneNode.activeTab || tabs[0];

        const DOCK_VIEWS = [
            { id: 'gantt',     name: 'Cronograma',   icon: '📊' },
            { id: 'timeblock', name: 'Timeblocking', icon: '⏰' },
            { id: 'kanban',    name: 'Kanban',       icon: '📋' },
            { id: 'projects',  name: 'Projetos',     icon: '💼' },
            { id: 'habits',    name: 'Hábitos',      icon: '✨' },
            { id: 'postits',   name: 'Post-its',     icon: '📌' },
            { id: 'finances',  name: 'Finanças',     icon: '💳' },
        ];

        tabs.forEach(tabKey => {
            const info = DOCK_VIEWS.find(v => v.id === tabKey) || { id: tabKey, name: tabKey, icon: '📄' };
            const tabBtn = tabbar.createDiv(`kt-dock-tab${tabKey === activeTab ? ' active' : ''}`);
            tabBtn.setText(`${info.icon} ${info.name}`);
            tabBtn.title = `Clique para ativar • Arraste para mover/dividir painel`;
            tabBtn.setAttribute('draggable', 'true');

            tabBtn.onclick = async (e) => {
                e.stopPropagation();
                if (paneNode.activeTab !== tabKey) {
                    paneNode.activeTab = tabKey;
                    this.viewMode = tabKey;
                    await this.saveDockLayout();
                    this.render();
                }
            };

            // Drag Tab (Docking)
            tabBtn.addEventListener('dragstart', (e) => {
                this.draggedDockTab = { fromPaneId: paneNode.id, tabId: tabKey };
                e.dataTransfer.setData('text/plain', `dock-tab:${tabKey}`);
                e.dataTransfer.effectAllowed = 'move';
                document.body.classList.add('kt-is-dock-dragging');
            });

            tabBtn.addEventListener('dragend', () => {
                document.body.classList.remove('kt-is-dock-dragging');
                this.draggedDockTab = null;
            });

            // Close tab button (if more than 1 tab in this pane)
            if (tabs.length > 1) {
                const closeBtn = tabBtn.createSpan('kt-dock-tab-close');
                closeBtn.setText('×');
                closeBtn.title = 'Fechar esta aba do painel';
                closeBtn.onclick = async (e) => {
                    e.stopPropagation();
                    paneNode.tabs = paneNode.tabs.filter(t => t !== tabKey);
                    if (paneNode.activeTab === tabKey) {
                        paneNode.activeTab = paneNode.tabs[0];
                    }
                    await this.saveDockLayout();
                    this.render();
                };
            }
        });

        // Pane Action Buttons
        const actions = header.createDiv('kt-dock-pane-actions');

        // Add View Button
        const addBtn = actions.createEl('button', { cls: 'kt-dock-action-btn', text: '＋' });
        addBtn.title = 'Adicionar visualização a este painel';
        addBtn.onclick = (e) => {
            e.stopPropagation();
            const menu = new obsidian.Menu();
            DOCK_VIEWS.forEach(dv => {
                menu.addItem(item => {
                    item.setTitle(`${dv.icon} ${dv.name}`)
                        .onClick(async () => {
                            if (!paneNode.tabs) paneNode.tabs = [];
                            if (!paneNode.tabs.includes(dv.id)) {
                                paneNode.tabs.push(dv.id);
                            }
                            paneNode.activeTab = dv.id;
                            await this.saveDockLayout();
                            this.render();
                        });
                });
            });
            menu.showAtMouseEvent(e);
        };

        // Split Horizontal
        const splitHBtn = actions.createEl('button', { cls: 'kt-dock-action-btn', text: '◫' });
        splitHBtn.title = 'Dividir painel na Horizontal (Lado a Lado)';
        splitHBtn.onclick = (e) => {
            e.stopPropagation();
            this.splitDockPane(paneNode.id, 'row');
        };

        // Split Vertical
        const splitVBtn = actions.createEl('button', { cls: 'kt-dock-action-btn', text: '⬒' });
        splitVBtn.title = 'Dividir painel na Vertical (Cima e Baixo)';
        splitVBtn.onclick = (e) => {
            e.stopPropagation();
            this.splitDockPane(paneNode.id, 'column');
        };

        // Maximize / Restore
        if (showMultiControls || isMaximized) {
            const maxBtn = actions.createEl('button', { cls: `kt-dock-action-btn${isMaximized ? ' active' : ''}`, text: isMaximized ? '🗗' : '🗖' });
            maxBtn.title = isMaximized ? 'Restaurar layout dividido' : 'Maximizar este painel';
            maxBtn.onclick = (e) => {
                e.stopPropagation();
                this.maximizedPaneId = isMaximized ? null : paneNode.id;
                this.render();
            };
        }

        // Close Pane
        if (showMultiControls && !isMaximized) {
            const closePaneBtn = actions.createEl('button', { cls: 'kt-dock-action-btn', text: '✕' });
            closePaneBtn.title = 'Fechar este painel';
            closePaneBtn.onclick = (e) => {
                e.stopPropagation();
                this.closeDockPane(paneNode.id);
            };
        }

        // 2. Pane Content
        const contentEl = paneEl.createDiv('kt-dock-pane-content');
        this.renderDockViewContent(contentEl, activeTab);

        // 3. Drop Overlay for Docking Drag & Drop
        const dropOverlay = paneEl.createDiv('kt-dock-drop-overlay');
        const previewBox = dropOverlay.createDiv('kt-dock-drop-preview');

        const calculateDropPosition = (e) => {
            const rect = paneEl.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const relY = (e.clientY - rect.top) / rect.height;

            if (relX < 0.25) return 'left';
            if (relX > 0.75) return 'right';
            if (relY < 0.25) return 'top';
            if (relY > 0.75) return 'bottom';
            return 'center';
        };

        paneEl.addEventListener('dragover', (e) => {
            if (!this.draggedDockTab) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const pos = calculateDropPosition(e);
            previewBox.className = `kt-dock-drop-preview active kt-dock-preview-${pos}`;
        });

        paneEl.addEventListener('dragleave', (e) => {
            if (!paneEl.contains(e.relatedTarget)) {
                previewBox.className = 'kt-dock-drop-preview';
            }
        });

        paneEl.addEventListener('drop', (e) => {
            if (!this.draggedDockTab) return;
            e.preventDefault();
            previewBox.className = 'kt-dock-drop-preview';

            const pos = calculateDropPosition(e);
            const { fromPaneId, tabId } = this.draggedDockTab;
            this.draggedDockTab = null;
            document.body.classList.remove('kt-is-dock-dragging');

            this.moveDockTab(fromPaneId, paneNode.id, tabId, pos);
        });
    }

    renderDockViewContent(container, viewMode) {
        if (viewMode === 'gantt') {
            this.renderGantt(container);
        } else if (viewMode === 'timeblock') {
            this.renderTimeblock(container);
        } else if (viewMode === 'kanban') {
            this.renderFullKanban(container);
        } else if (viewMode === 'projects') {
            this.renderProjectsView(container);
        } else if (viewMode === 'habits') {
            this.renderHabitsView(container);
        } else if (viewMode === 'postits') {
            this.renderPostItsView(container);
        } else if (viewMode === 'finances') {
            this.renderFinancesView(container);
        } else {
            this.renderGantt(container);
        }
    }

    // ----------------------------------------------------------
    // ROOT RENDER
    // ----------------------------------------------------------

    render() {
        const wrap = this.contentEl || (this.containerEl && this.containerEl.children && this.containerEl.children[1]) || this.containerEl;
        if (!wrap) return;

        // Save scroll positions before clearing DOM
        const prevTbScroll = wrap.querySelector('.kt-tb-scroll-area');
        if (prevTbScroll) {
            this.savedTbScrollTop = prevTbScroll.scrollTop;
        }
        const prevSidebarScroll = wrap.querySelector('.kt-tb-sidebar');
        if (prevSidebarScroll) {
            this.savedSidebarScrollTop = prevSidebarScroll.scrollTop;
        }
        const prevGanttScroll = wrap.querySelector('.kt-gantt-scroll');
        if (prevGanttScroll) {
            this.savedGanttScrollLeft = prevGanttScroll.scrollLeft;
            this.savedGanttScrollTop = prevGanttScroll.scrollTop;
        }
        if (this.viewMode === 'projects' || this.viewMode === 'habits' || this.viewMode === 'postits' || this.viewMode === 'finances') {
            this.savedPageScrollTop = wrap.scrollTop;
        }
        const prevFinTablesScroll = wrap.querySelector('.kt-fin-tables-scroll');
        if (prevFinTablesScroll) {
            this.savedFinancesTablesScrollTop = prevFinTablesScroll.scrollTop;
        }
        const prevFinRightScroll = wrap.querySelector('.kt-fin-right-col');
        if (prevFinRightScroll) {
            this.savedFinancesRightColScrollTop = prevFinRightScroll.scrollTop;
        }

        wrap.empty();
        wrap.addClass('kt-wrap');

        this.renderToolbar(wrap);

        const main = wrap.createDiv('kt-main');
        main.style.display = 'flex';
        main.style.flex = '1';
        main.style.overflow = 'hidden';
        main.style.minHeight = '0';
        main.style.minWidth = '0';

        this.renderDockLayout(main);
    }

    openDayInTimeblocking(date) {
        if (!date) return;
        const target = new Date(date);
        target.setHours(0, 0, 0, 0);

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const dow = now.getDay();
        const diff = dow === 0 ? -6 : 1 - dow;
        const currentWeekMonday = new Date(now);
        currentWeekMonday.setDate(currentWeekMonday.getDate() + diff);

        const targetDow = target.getDay();
        const targetDiff = targetDow === 0 ? -6 : 1 - targetDow;
        const targetMonday = new Date(target);
        targetMonday.setDate(targetMonday.getDate() + targetDiff);

        const msPerWeek = 7 * 86400000;
        this.weekOffset = Math.round((targetMonday.getTime() - currentWeekMonday.getTime()) / msPerWeek);
        this.selectedDay = target;
        this.viewMode = 'timeblock';
        this.savedTbScrollTop = null;
        if (this.plugin.settings.remoteCalendars?.length > 0 && Date.now() - (this.plugin.lastRemoteSync || 0) > 2 * 60 * 1000) {
            this.plugin.syncAllRemoteCalendars(false);
        }

        this.plugin.settings.timeblockSubView = 'day';
        this.plugin.saveSettings();

        // Activate Timeblocking in layout
        const layout = this.getDockLayout();
        const allPanes = this.getAllDockPanes(layout);
        if (allPanes.length === 1) {
            allPanes[0].activeTab = 'timeblock';
            allPanes[0].tabs = ['timeblock'];
            this.saveDockLayout(layout);
        } else if (allPanes.length > 0) {
            const tbPane = allPanes.find(p => p.activeTab === 'timeblock' || p.tabs?.includes('timeblock'));
            if (tbPane) {
                tbPane.activeTab = 'timeblock';
                if (!tbPane.tabs?.includes('timeblock')) tbPane.tabs.push('timeblock');
            } else {
                allPanes[0].activeTab = 'timeblock';
                if (!allPanes[0].tabs?.includes('timeblock')) allPanes[0].tabs.push('timeblock');
            }
            this.saveDockLayout(layout);
        }

        this.render();
    }

    // ----------------------------------------------------------
    // TOOLBAR
    // ----------------------------------------------------------

    getGanttDays(containerWidth) {
        const mode = this.plugin.settings.ganttDaysMode || '14';
        if (mode === 'auto') {
            const availableW = (containerWidth || window.innerWidth) - 260;
            const daysCount = Math.max(14, Math.floor(availableW / 75));
            return daysCount;
        }
        if (mode === 'month') {
            return 28;
        }
        return parseInt(mode, 10) || 14;
    }

    renderToolbar(parent) {
        const tb = parent.createDiv('kt-toolbar');

        // View mode tabs (Minimalist Obsidian style)
        const tabs = tb.createDiv('kt-tabs');

        const ganttTab    = tabs.createEl('button', { cls: 'kt-tab', text: 'Cronograma' });
        const timeTab     = tabs.createEl('button', { cls: 'kt-tab', text: 'Timeblocking' });
        const kanbanTab   = tabs.createEl('button', { cls: 'kt-tab', text: 'Kanban' });
        const projectsTab = tabs.createEl('button', { cls: 'kt-tab', text: 'Projetos' });
        const habitsTab   = tabs.createEl('button', { cls: 'kt-tab', text: 'Hábitos' });
        const postItsTab  = tabs.createEl('button', { cls: 'kt-tab', text: 'Post-its' });
        const financesTab = tabs.createEl('button', { cls: 'kt-tab', text: 'Finanças' });

        if (this.viewMode === 'gantt')     ganttTab.addClass('active');
        if (this.viewMode === 'timeblock') timeTab.addClass('active');
        if (this.viewMode === 'kanban')    kanbanTab.addClass('active');
        if (this.viewMode === 'projects')  projectsTab.addClass('active');
        if (this.viewMode === 'habits')    habitsTab.addClass('active');
        if (this.viewMode === 'postits')   postItsTab.addClass('active');
        if (this.viewMode === 'finances')  financesTab.addClass('active');

        // Make top tabs draggable into docking layout
        const makeTopTabDraggable = (btn, viewId) => {
            btn.setAttribute('draggable', 'true');
            btn.title = 'Clique para alternar • Arraste para dividir/encaixar na tela';
            btn.addEventListener('dragstart', (e) => {
                this.draggedDockTab = { fromPaneId: null, tabId: viewId };
                e.dataTransfer.setData('text/plain', `dock-tab:${viewId}`);
                e.dataTransfer.effectAllowed = 'move';
                document.body.classList.add('kt-is-dock-dragging');
            });
            btn.addEventListener('dragend', () => {
                document.body.classList.remove('kt-is-dock-dragging');
                this.draggedDockTab = null;
            });
        };

        makeTopTabDraggable(ganttTab, 'gantt');
        makeTopTabDraggable(timeTab, 'timeblock');
        makeTopTabDraggable(kanbanTab, 'kanban');
        makeTopTabDraggable(projectsTab, 'projects');
        makeTopTabDraggable(habitsTab, 'habits');
        makeTopTabDraggable(postItsTab, 'postits');
        makeTopTabDraggable(financesTab, 'finances');

        const switchMainView = async (vMode) => {
            this.viewMode = vMode;
            const layout = this.getDockLayout();
            const allPanes = this.getAllDockPanes(layout);
            if (allPanes.length === 1) {
                allPanes[0].activeTab = vMode;
                allPanes[0].tabs = [vMode];
                await this.saveDockLayout(layout);
            } else if (allPanes.length > 0) {
                allPanes[0].activeTab = vMode;
                if (!allPanes[0].tabs?.includes(vMode)) allPanes[0].tabs.push(vMode);
                await this.saveDockLayout(layout);
            }
            this.render();
        };

        ganttTab.onclick    = () => {
            if (this.plugin.settings.remoteCalendars?.length > 0 && Date.now() - (this.plugin.lastRemoteSync || 0) > 2 * 60 * 1000) {
                this.plugin.syncAllRemoteCalendars(false);
            }
            switchMainView('gantt');
        };
        timeTab.onclick     = () => {
            if (this.plugin.settings.remoteCalendars?.length > 0 && Date.now() - (this.plugin.lastRemoteSync || 0) > 2 * 60 * 1000) {
                this.plugin.syncAllRemoteCalendars(false);
            }
            switchMainView('timeblock');
        };
        kanbanTab.onclick   = () => switchMainView('kanban');
        projectsTab.onclick = () => switchMainView('projects');
        habitsTab.onclick   = async () => {
            await switchMainView('habits');
            if (this.plugin.settings.awConnected) {
                const now = Date.now();
                if (now - (this._lastAwHabitsSync || 0) > 30000) {
                    this._lastAwHabitsSync = now;
                    await this.syncActivityWatchHabits();
                    if (this.hasActiveDockView('habits')) {
                        this.render();
                    }
                }
            }
        };
        postItsTab.onclick  = () => switchMainView('postits');
        financesTab.onclick = () => switchMainView('finances');

        // Navigation (for Gantt, Timeblocking & Habits)
        const showNav = this.hasActiveDockView('gantt') || this.hasActiveDockView('timeblock') || this.hasActiveDockView('habits');
        if (showNav) {
            const nav = tb.createDiv('kt-nav');

            const prevBtn = nav.createEl('button', { cls: 'kt-nav-btn', text: '‹' });

            const isGanttActive  = this.hasActiveDockView('gantt');
            const isTbActive     = this.hasActiveDockView('timeblock');
            const isHabitsActive = this.hasActiveDockView('habits');
            const isCalView      = isGanttActive && (this.plugin.settings.cronogramaSubView === 'calendar');
            const lbl            = nav.createDiv('kt-date-label');

            if (isGanttActive && isCalView) {
                const mInfo = this.getCalendarGridInfo();
                lbl.setText(mInfo.monthLabel);
            } else if (isTbActive && !isGanttActive && this.plugin.settings.timeblockSubView === 'day') {
                const targetDay = this.selectedDay || new Date();
                lbl.setText(this.dayLabel(targetDay, true));
            } else {
                const ws            = this.getWeekStart();
                const daysDisplayed = isGanttActive ? this.getGanttDays() : 7;
                const we            = new Date(ws); we.setDate(we.getDate() + (daysDisplayed - 1));
                lbl.setText(`${this.dayLabel(ws, false)} — ${this.dayLabel(we, false)}`);
            }

            const nextBtn = nav.createEl('button', { cls: 'kt-nav-btn', text: '›' });

            const todayBtn = nav.createEl('button', { cls: 'kt-nav-btn kt-today-btn', text: 'Hoje' });
            todayBtn.onclick = async () => {
                this.weekOffset = 0;
                this.monthOffset = 0;
                this.selectedDay = new Date();
                this.awHabitCache = {};
                this.render();
                if (isHabitsActive && this.plugin.settings.awConnected) {
                    await this.syncActivityWatchHabits();
                    if (this.hasActiveDockView('habits')) this.render();
                }
            };
            prevBtn.onclick  = async () => {
                if (isGanttActive && isCalView && this.plugin.settings.ganttDaysMode === 'month') {
                    this.monthOffset = (this.monthOffset || 0) - 1;
                } else if (isTbActive && !isGanttActive && this.plugin.settings.timeblockSubView === 'day') {
                    const cur = this.selectedDay || new Date();
                    const prevD = new Date(cur); prevD.setDate(prevD.getDate() - 1);
                    this.selectedDay = prevD;
                } else {
                    this.weekOffset--;
                }
                this.awHabitCache = {};
                this.render();
                if (isHabitsActive && this.plugin.settings.awConnected) {
                    await this.syncActivityWatchHabits();
                    if (this.hasActiveDockView('habits')) this.render();
                }
            };
            nextBtn.onclick  = async () => {
                if (isGanttActive && isCalView && this.plugin.settings.ganttDaysMode === 'month') {
                    this.monthOffset = (this.monthOffset || 0) + 1;
                } else if (isTbActive && !isGanttActive && this.plugin.settings.timeblockSubView === 'day') {
                    const cur = this.selectedDay || new Date();
                    const nextD = new Date(cur); nextD.setDate(nextD.getDate() + 1);
                    this.selectedDay = nextD;
                } else {
                    this.weekOffset++;
                }
                this.awHabitCache = {};
                this.render();
                if (isHabitsActive && this.plugin.settings.awConnected) {
                    await this.syncActivityWatchHabits();
                    if (this.hasActiveDockView('habits')) this.render();
                }
            };

            if (this.plugin.settings.remoteCalendars && this.plugin.settings.remoteCalendars.length > 0) {
                const syncCalBtn = nav.createEl('button', { cls: 'kt-nav-btn kt-sync-cal-btn', text: '🔄 Agenda' });
                syncCalBtn.title = 'Sincronizar eventos do Google Agenda / Calendários Remotos';
                syncCalBtn.onclick = async () => {
                    syncCalBtn.setText('⏳ Sincronizando...');
                    const count = await this.plugin.syncAllRemoteCalendars(true);
                    syncCalBtn.setText('🔄 Agenda');
                    new obsidian.Notice(`✓ Google Agenda sincronizado: ${count} eventos.`);
                };
            }
        }

        // Sub-view Toggle for Cronograma (Gantt vs Calendar Grid)
        if (this.hasActiveDockView('gantt')) {
            const subToggle = tb.createDiv('kt-subview-toggle');
            const curSub = this.plugin.settings.cronogramaSubView || 'gantt';

            const ganttBtn = subToggle.createEl('button', {
                cls: `kt-subview-btn ${curSub === 'gantt' ? 'is-active' : ''}`,
                text: '📊 Gantt'
            });
            ganttBtn.title = 'Visualização em barras horizontais contínuas (Gantt)';
            ganttBtn.onclick = async () => {
                this.plugin.settings.cronogramaSubView = 'gantt';
                await this.plugin.saveSettings();
                this.render();
            };

            const calBtn = subToggle.createEl('button', {
                cls: `kt-subview-btn ${curSub === 'calendar' ? 'is-active' : ''}`,
                text: '📅 Calendário'
            });
            calBtn.title = 'Visualização em grade de calendário com cartões (estilo Trello)';
            calBtn.onclick = async () => {
                this.plugin.settings.cronogramaSubView = 'calendar';
                await this.plugin.saveSettings();
                this.render();
            };
        }

        // Sub-view Toggle for Timeblocking (1 Dia vs Semana Multi-Day)
        if (this.hasActiveDockView('timeblock')) {
            const subToggle = tb.createDiv('kt-subview-toggle');
            const curSub = this.plugin.settings.timeblockSubView || 'day';

            const dayBtn = subToggle.createEl('button', {
                cls: `kt-subview-btn ${curSub === 'day' ? 'is-active' : ''}`,
                text: '📅 1 Dia'
            });
            dayBtn.title = 'Visualização focada no dia selecionado com barra lateral';
            dayBtn.onclick = async () => {
                this.plugin.settings.timeblockSubView = 'day';
                await this.plugin.saveSettings();
                this.render();
            };

            const weekBtn = subToggle.createEl('button', {
                cls: `kt-subview-btn ${curSub === 'week' ? 'is-active' : ''}`,
                text: '🗓️ Semana'
            });
            weekBtn.title = 'Visualização semanal com dias lado a lado (Multi-Day View)';
            weekBtn.onclick = async () => {
                this.plugin.settings.timeblockSubView = 'week';
                await this.plugin.saveSettings();
                this.render();
            };

            // Days filter (7d vs 5d / Seg-Sex) when in Week mode
            if (curSub === 'week') {
                const daysToggle = tb.createDiv('kt-subview-toggle');
                const hideW = !!this.plugin.settings.timeblockHideWeekends;

                const d7Btn = daysToggle.createEl('button', {
                    cls: `kt-subview-btn ${!hideW ? 'is-active' : ''}`,
                    text: '7d'
                });
                d7Btn.title = 'Visualizar todos os 7 dias da semana (Seg a Dom)';
                d7Btn.onclick = async () => {
                    this.plugin.settings.timeblockHideWeekends = false;
                    await this.plugin.saveSettings();
                    this.render();
                };

                const d5Btn = daysToggle.createEl('button', {
                    cls: `kt-subview-btn ${hideW ? 'is-active' : ''}`,
                    text: '5d (Seg-Sex)'
                });
                d5Btn.title = 'Ocultar Sábado e Domingo (Segunda a Sexta)';
                d5Btn.onclick = async () => {
                    this.plugin.settings.timeblockHideWeekends = true;
                    await this.plugin.saveSettings();
                    this.render();
                };
            }
        }

        // Period Range Selector (If Gantt/Cronograma view is active)
        if (this.hasActiveDockView('gantt')) {
            const rangeSelector = tb.createDiv('kt-range-selector');
            const currentMode   = this.plugin.settings.ganttDaysMode || '14';

            const options = [
                { id: '14',    label: '14d (2 Sem)' },
                { id: '21',    label: '21d (3 Sem)' },
                { id: '28',    label: '28d (4 Sem)' },
                { id: 'month', label: '📅 1 Mês' },
                { id: 'auto',  label: '⛶ Auto' },
            ];

            options.forEach(opt => {
                const btn = rangeSelector.createEl('button', {
                    cls: `kt-range-btn ${currentMode === opt.id ? 'is-active' : ''}`,
                    text: opt.label
                });
                btn.title = `Visualizar ${opt.label}`;
                btn.onclick = async () => {
                    this.plugin.settings.ganttDaysMode = opt.id;
                    await this.plugin.saveSettings();
                    this.render();
                };
            });
        }

        // Layouts / Workspace Presets Menu Button
        const layoutBtn = tb.createEl('button', { cls: 'kt-layout-btn', text: '◫ Layout' });
        layoutBtn.title = 'Configurar divisões de tela e layouts (estilo Blender / Unity)';
        layoutBtn.onclick = (e) => {
            e.stopPropagation();
            const menu = new obsidian.Menu();
            
            menu.addItem(item => {
                item.setTitle('🔲 Padrão (1 Painel)')
                    .onClick(() => this.applyDockPreset('single'));
            });
            menu.addSeparator();
            menu.addItem(item => {
                item.setTitle('◫ Timeblocking + Cronograma (Lado a Lado)')
                    .onClick(() => this.applyDockPreset('tb-gantt-h'));
            });
            menu.addItem(item => {
                item.setTitle('⬒ Cronograma + Timeblocking (Cima / Baixo)')
                    .onClick(() => this.applyDockPreset('gantt-tb-v'));
            });
            menu.addItem(item => {
                item.setTitle('📑 Timeblocking + Kanban (Lado a Lado)')
                    .onClick(() => this.applyDockPreset('tb-kanban-h'));
            });
            menu.addItem(item => {
                item.setTitle('🗔 Tríplice (Timeblocking + Cronograma + Kanban)')
                    .onClick(() => this.applyDockPreset('triple'));
            });
            menu.addSeparator();
            menu.addItem(item => {
                item.setTitle('🔄 Redefinir Layout')
                    .onClick(() => this.applyDockPreset('single'));
            });

            menu.showAtMouseEvent(e);
        };

        // File selector
        const files  = this.app.vault.getFiles().filter(f => f.extension === 'md');
        const picker = tb.createDiv('kt-file-picker');
        const sel    = picker.createEl('select', { cls: 'kt-file-select' });

        files.forEach(f => {
            const opt = sel.createEl('option', { value: f.path, text: f.path });
            if (f.path === this.plugin.settings.kanbanFile) opt.selected = true;
        });

        sel.onchange = async () => {
            this.plugin.settings.kanbanFile = sel.value;
            await this.plugin.saveSettings();
            await this.refresh();
        };
    }

    // ----------------------------------------------------------
    // CRONOGRAMA VIEW (Gantt & Calendar Grid)
    // ----------------------------------------------------------

    renderGantt(container) {
        const subView = this.plugin.settings.cronogramaSubView || 'gantt';
        if (subView === 'calendar') {
            this.renderCalendarGrid(container);
        } else {
            this.renderGanttTimeline(container);
        }
    }

    getCalendarGridInfo(containerWidth) {
        const mode = this.plugin.settings.ganttDaysMode || '14';
        
        if (mode === 'month') {
            const now = new Date();
            const baseMonth = now.getMonth() + (this.monthOffset || 0);
            const targetDate = new Date(now.getFullYear(), baseMonth, 1);
            const y = targetDate.getFullYear();
            const m = targetDate.getMonth();

            const firstDayOfMonth = new Date(y, m, 1);
            const lastDayOfMonth = new Date(y, m + 1, 0);

            // Monday start: 0=Sun->-6, 1=Mon->0, 2=Tue->-1, etc.
            const firstDow = firstDayOfMonth.getDay();
            const startDiff = firstDow === 0 ? -6 : 1 - firstDow;
            const gridStart = new Date(firstDayOfMonth);
            gridStart.setDate(gridStart.getDate() + startDiff);

            const days = [];
            const cur = new Date(gridStart);
            while (cur <= lastDayOfMonth || days.length % 7 !== 0 || days.length < 28) {
                days.push(new Date(cur));
                cur.setDate(cur.getDate() + 1);
                if (days.length >= 42) break; // Max 6 weeks
            }

            const weeksCount = Math.ceil(days.length / 7);
            const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            const monthLabel = `${monthNames[m]} de ${y}`;

            return {
                isMonthMode: true,
                targetDate,
                monthLabel,
                targetMonth: m,
                targetYear: y,
                days,
                weeksCount
            };
        } else {
            // Multi-week mode (14d, 21d, 28d, auto)
            const ws = this.getWeekStart();
            const rawDays = this.getGanttDays(containerWidth);
            const weeksCount = Math.max(1, Math.ceil(rawDays / 7));
            const totalDays = weeksCount * 7;

            const days = [];
            for (let i = 0; i < totalDays; i++) {
                const d = new Date(ws);
                d.setDate(d.getDate() + i);
                days.push(d);
            }

            const we = days[days.length - 1];
            const dateLabel = `${this.dayLabel(ws, false)} — ${this.dayLabel(we, false)}`;

            return {
                isMonthMode: false,
                targetDate: ws,
                monthLabel: dateLabel,
                targetMonth: ws.getMonth(),
                targetYear: ws.getFullYear(),
                days,
                weeksCount
            };
        }
    }

    getMonthGrid(containerWidth) {
        return this.getCalendarGridInfo(containerWidth);
    }

    renderCalendarGrid(container) {
        const monthInfo     = this.getCalendarGridInfo(container.clientWidth || window.innerWidth);
        const days          = monthInfo.days;
        const weeksCount    = monthInfo.weeksCount;
        const scheduled     = this.cards.filter(c => c.startDate && !c.isEvent && !c.isRemoteCalendarEvent && c.column !== 'Rotina' && !isIgnoredColumn(c.column));
        const unscheduled   = this.cards.filter(c => !c.startDate && !c.isCompleted && !c.isEvent && c.column !== 'Rotina' && !isIgnoredColumn(c.column));

        const calContainer = container.createDiv('kt-cal-container');
        const calSection = calContainer.createDiv('kt-cal-section');

        // 1. Weekday Headers (Dom, Seg, Ter, Qua, Qui, Sex, Sáb)
        const weekdaysHdr = calSection.createDiv('kt-cal-weekdays-header');
        const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        for (let i = 0; i < 7; i++) {
            const d = days[i];
            const wday = weekdaysHdr.createDiv('kt-cal-weekday-title');
            wday.setText(dayNames[d.getDay()]);
            if (d.getDay() === 0 || d.getDay() === 6) wday.addClass('kt-is-weekend');
        }

        // 2. Calendar Grid Area by Week Rows (Continuous multi-day bars)
        const weeksClass = weeksCount <= 2 ? 'kt-weeks-2' : (weeksCount === 3 ? 'kt-weeks-3' : (weeksCount === 4 ? 'kt-weeks-4' : 'kt-weeks-compact'));
        const gridArea = calSection.createDiv(`kt-cal-grid ${weeksClass}`);

        for (let w = 0; w < weeksCount; w++) {
            const weekDays = days.slice(w * 7, w * 7 + 7);
            const weekRow = gridArea.createDiv('kt-cal-week-row');

            // Layer A: Background 7 Day Cells
            const weekBg = weekRow.createDiv('kt-cal-week-bg');
            weekDays.forEach((d, colIdx) => {
                const globalDayIdx = w * 7 + colIdx;
                const isToday = sameDay(d, new Date());
                const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
                const isOtherMonth = d.getMonth() !== monthInfo.targetMonth;

                const dayCell = weekBg.createDiv(`kt-cal-day-cell${isToday ? ' kt-is-today' : ''}${isWeekend ? ' kt-is-weekend' : ''}${isOtherMonth ? ' kt-is-other-month' : ''}`);
                dayCell.dataset.dayIndex = String(globalDayIdx);
                dayCell.dataset.date = formatDate(d);

                const cellHdr = dayCell.createDiv('kt-cal-day-header');
                const numEl = cellHdr.createSpan('kt-cal-day-num');
                if (d.getDate() === 1 || (w === 0 && colIdx === 0)) {
                    const monthShorts = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                    numEl.setText(`${d.getDate()} ${monthShorts[d.getMonth()]}`);
                } else {
                    numEl.setText(String(d.getDate()));
                }

                // Drag & drop directly on day cell
                dayCell.addEventListener('dragover', (e) => {
                    if (!this.draggedCard) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    dayCell.classList.add('kt-cal-drop-hover');
                });

                dayCell.addEventListener('dragleave', (e) => {
                    if (!dayCell.contains(e.relatedTarget)) {
                        dayCell.classList.remove('kt-cal-drop-hover');
                    }
                });

                dayCell.addEventListener('drop', async (e) => {
                    if (!this.draggedCard) return;
                    e.preventDefault();
                    dayCell.classList.remove('kt-cal-drop-hover');

                    const card = this.draggedCard;
                    this.draggedCard = null;

                    const targetDate = startOfDay(d);
                    let durationDays = 0;
                    if (card.startDate && card.endDate) {
                        const s = startOfDay(card.startDate);
                        const end = startOfDay(card.endDate);
                        durationDays = Math.max(0, Math.round((end.getTime() - s.getTime()) / 86400000));
                    }

                    const newEndDate = new Date(targetDate);
                    newEndDate.setDate(newEndDate.getDate() + durationDays);

                    await this.persistDateRange(card, targetDate, newEndDate);
                    await this.refresh();
                });

                dayCell.onclick = (e) => {
                    if (e.target === dayCell || e.target === cellHdr || e.target === numEl) {
                        this.openDayInTimeblocking(d);
                    }
                };
            });

            // Layer B: Foreground Continuous Events Tracks
            const weekStart = startOfDay(weekDays[0]);
            const weekEnd = endOfDay(weekDays[6]);

            const weekCards = scheduled.filter(c => {
                const s = startOfDay(c.startDate);
                const e = endOfDay(c.endDate || c.startDate);
                return e >= weekStart && s <= weekEnd;
            });

            // Multi-day cards first (longer duration first), then by start date
            weekCards.sort((a, b) => {
                const durA = (a.endDate ? a.endDate.getTime() : a.startDate.getTime()) - a.startDate.getTime();
                const durB = (b.endDate ? b.endDate.getTime() : b.startDate.getTime()) - b.startDate.getTime();
                if (durB !== durA) return durB - durA;
                return a.startDate.getTime() - b.startDate.getTime();
            });

            const tracks = [];
            const eventsLayer = weekRow.createDiv('kt-cal-week-events-layer');

            weekCards.forEach(card => {
                const cardStart = startOfDay(card.startDate);
                const cardEnd = endOfDay(card.endDate || card.startDate);

                let startCol = 0;
                for (let c = 0; c < 7; c++) {
                    if (sameDay(weekDays[c], cardStart) || weekDays[c] > cardStart) {
                        startCol = c;
                        break;
                    }
                }
                if (cardStart < weekStart) startCol = 0;

                let endCol = 6;
                for (let c = 6; c >= 0; c--) {
                    if (sameDay(weekDays[c], cardEnd) || weekDays[c] < cardEnd) {
                        endCol = c;
                        break;
                    }
                }
                if (cardEnd > weekEnd) endCol = 6;

                if (startCol > endCol) startCol = endCol;
                const colSpan = endCol - startCol + 1;

                // Find track
                let trackIdx = 0;
                while (true) {
                    if (!tracks[trackIdx]) {
                        tracks[trackIdx] = [false, false, false, false, false, false, false];
                    }
                    let coll = false;
                    for (let col = startCol; col <= endCol; col++) {
                        if (tracks[trackIdx][col]) { coll = true; break; }
                    }
                    if (!coll) {
                        for (let col = startCol; col <= endCol; col++) {
                            tracks[trackIdx][col] = true;
                        }
                        break;
                    }
                    trackIdx++;
                }

                const isStart = cardStart >= weekStart;
                const isEnd = cardEnd <= weekEnd;
                const isMultiDay = (card.endDate && !sameDay(card.startDate, card.endDate));

                const bar = eventsLayer.createDiv(`kt-cal-bar${isMultiDay ? ' kt-cal-bar-multi' : ''}${card.isCompleted ? ' is-completed' : ''}`);
                bar.style.gridColumn = `${startCol + 1} / span ${colSpan}`;
                bar.style.gridRow = `${trackIdx + 1}`;

                const projColor = card.tagColor || card.projectColor || getCardTagColor(card.tags, this.plugin.settings.projects) || getProjectColor([], card.column, this.plugin.settings.columnColors) || '#6366f1';
                bar.style.setProperty('--proj-color', projColor);

                if (!isStart) bar.addClass('kt-cal-cont-prev');
                if (!isEnd) bar.addClass('kt-cal-cont-next');

                // Left resize handle (Drag to adjust start date)
                if (isStart) {
                    const handleL = bar.createDiv('kt-cal-bar-handle kt-cal-handle-left');
                    handleL.title = 'Arrastar para alterar data de início';
                    this.attachCalendarResize(handleL, 'start', card, days);
                }

                // Right resize handle (Drag to adjust end date)
                if (isEnd) {
                    const handleR = bar.createDiv('kt-cal-bar-handle kt-cal-handle-right');
                    handleR.title = 'Arrastar para alterar data de término';
                    this.attachCalendarResize(handleR, 'end', card, days);
                }

                // Inner wrapper for 1-line card layout: [ ⚪ Checkbox | Título           ⏱ Horas | #Tag ]
                const innerWrap = bar.createDiv('kt-cal-card-inner');
                const row = innerWrap.createDiv('kt-cal-card-row');

                // Check circle
                if (isStart || !isMultiDay) {
                    const chk = row.createSpan('kt-cal-card-chk');
                    chk.setText(card.isCompleted ? '✓' : '○');
                    chk.title = card.isCompleted ? 'Marcar como pendente' : 'Concluir tarefa';
                    chk.onclick = async (e) => {
                        e.stopPropagation();
                        await this.toggleCardCompletion(card);
                    };
                }

                const titleEl = row.createDiv('kt-cal-card-title');
                titleEl.setText(card.title);

                const metaRow = row.createDiv('kt-cal-card-meta-row');

                if (isStart && card.estimateMinutes && card.estimateMinutes > 0) {
                    const estSpan = metaRow.createSpan('kt-cal-card-est');
                    estSpan.setText(`⏱ ${card.estimateText}`);
                }

                if (card.tags && card.tags.length > 0) {
                    this.renderTagPills(metaRow, card.tags, true);
                }

                const sStr = formatDate(card.startDate);
                const eStr = card.endDate ? formatDate(card.endDate) : sStr;
                bar.title = `${card.title} (${sStr === eStr ? sStr : `${sStr} → ${eStr}`})`;

                // Dragging
                bar.setAttribute('draggable', 'true');
                bar.addEventListener('dragstart', (e) => {
                    this.draggedCard = card;
                    e.dataTransfer.setData('text/plain', card.id);
                    e.dataTransfer.effectAllowed = 'move';
                    bar.classList.add('kt-dragging');
                    document.body.classList.add('kt-is-card-dragging');
                });
                bar.addEventListener('dragend', () => {
                    bar.classList.remove('kt-dragging');
                    document.body.classList.remove('kt-is-card-dragging');
                    this.draggedCard = null;
                });

                bar.onclick = (e) => {
                    e.stopPropagation();
                    this.openCardOptionsModal(card, card.startDate);
                };

                bar.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const menu = new obsidian.Menu();
                    menu.addItem(item => {
                        item.setTitle('Abrir detalhes da tarefa')
                            .setIcon('pencil')
                            .onClick(() => this.openCardOptionsModal(card, card.startDate));
                    });
                    menu.addItem(item => {
                        item.setTitle(card.isCompleted ? 'Marcar como pendente' : 'Concluir tarefa')
                            .setIcon(card.isCompleted ? 'check-circle' : 'circle')
                            .onClick(async () => await this.toggleCardCompletion(card));
                    });
                    menu.addItem(item => {
                        item.setTitle('Remover do cronograma')
                            .setIcon('calendar-x')
                            .onClick(async () => {
                                await this.clearCardDates(card);
                                await this.refresh();
                            });
                    });
                    menu.showAtMouseEvent(e);
                });
            });
        }

        // 3. Backlog Drawer (Overlay at bottom)
        this.renderBacklogDrawer(calContainer, unscheduled);
    }

    attachCalendarResize(handleEl, edgeType, card, allGridDays) {
        handleEl.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const currentStart = startOfDay(card.startDate);
            const currentEnd   = startOfDay(card.endDate || card.startDate);
            let previewStart = new Date(currentStart);
            let previewEnd   = new Date(currentEnd);
            let hasMoved     = false;

            document.body.classList.add('kt-is-resizing');

            const onPointerMove = (moveEvt) => {
                hasMoved = true;
                const target = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
                const cell = target ? target.closest('.kt-cal-day-cell') : null;

                if (cell && cell.dataset.dayIndex !== undefined) {
                    const idx = parseInt(cell.dataset.dayIndex, 10);
                    if (allGridDays[idx]) {
                        const hoveredDate = startOfDay(allGridDays[idx]);

                        if (edgeType === 'start') {
                            if (hoveredDate.getTime() <= currentEnd.getTime()) {
                                previewStart = hoveredDate;
                                previewEnd   = currentEnd;
                            } else {
                                previewStart = currentEnd;
                                previewEnd   = hoveredDate;
                            }
                        } else { // 'end'
                            if (hoveredDate.getTime() >= currentStart.getTime()) {
                                previewStart = currentStart;
                                previewEnd   = hoveredDate;
                            } else {
                                previewStart = hoveredDate;
                                previewEnd   = currentStart;
                            }
                        }

                        // Provide visual feedback on day cells
                        document.querySelectorAll('.kt-cal-day-cell').forEach((cEl) => {
                            const cIdx = parseInt(cEl.dataset.dayIndex, 10);
                            if (allGridDays[cIdx]) {
                                const cDate = startOfDay(allGridDays[cIdx]);
                                if (cDate >= previewStart && cDate <= previewEnd) {
                                    cEl.classList.add('kt-cal-resize-hover');
                                } else {
                                    cEl.classList.remove('kt-cal-resize-hover');
                                }
                            }
                        });
                    }
                }
            };

            const onPointerUp = async () => {
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.body.classList.remove('kt-is-resizing');
                document.querySelectorAll('.kt-cal-day-cell').forEach(cEl => cEl.classList.remove('kt-cal-resize-hover'));

                if (hasMoved) {
                    if (!sameDay(previewStart, card.startDate) || !sameDay(previewEnd, card.endDate || card.startDate)) {
                        await this.persistDateRange(card, previewStart, previewEnd);
                        await this.refresh();
                    }
                }
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });
    }

    renderGanttTimeline(container) {
        const ws            = this.getWeekStart();
        const daysDisplayed = this.getGanttDays(container.clientWidth || window.innerWidth);
        const scheduled     = this.cards.filter(c => c.startDate && !c.isEvent && c.column !== 'Rotina' && !isIgnoredColumn(c.column));
        const unscheduled   = this.cards.filter(c => !c.startDate && !c.isCompleted && !c.isEvent && c.column !== 'Rotina' && !isIgnoredColumn(c.column));

        // --- GANTT TIMELINE TOP SECTION ---
        const ganttSection = container.createDiv('kt-gantt-section');

        // Header
        const header = ganttSection.createDiv('kt-gantt-header');
        header.createDiv('kt-gantt-lbl-col').setText('TAREFA / PROJETO');

        const hdCells = header.createDiv('kt-gantt-cells');
        for (let i = 0; i < daysDisplayed; i++) {
            const d   = new Date(ws); d.setDate(d.getDate() + i);
            const cell = hdCells.createDiv('kt-gantt-hd-cell');
            cell.setText(this.dayLabel(d));
            cell.title = `Clique para abrir ${this.dayLabel(d)} no Timeblocking`;
            if (sameDay(d, new Date())) cell.addClass('kt-is-today');
            if (d.getDay() === 0 || d.getDay() === 6) cell.addClass('kt-is-weekend');

            cell.onclick = () => {
                this.openDayInTimeblocking(d);
            };
        }

        // Body
        const body = ganttSection.createDiv('kt-gantt-body');

        if (scheduled.length === 0) {
            const emptyEl = body.createDiv('kt-empty');
            emptyEl.setText('Nenhum card com data agendada no Cronograma.');
            emptyEl.createEl('span', {
                cls: 'kt-empty-sub',
                text: 'Arraste cards do painel abaixo para os dias desejados ou clique para agendar.'
            });
        } else {
            scheduled.forEach(card => this.renderGanttRow(body, card, ws, daysDisplayed));
        }

        // --- DRAG AND DROP HANDLERS FOR GANTT TIMELINE ---
        const getDayFromClientX = (clientX) => {
            const hdCells = Array.from(header.querySelectorAll('.kt-gantt-hd-cell'));
            for (let i = 0; i < hdCells.length; i++) {
                const rect = hdCells[i].getBoundingClientRect();
                if (clientX >= rect.left && clientX <= rect.right) {
                    const d = new Date(ws);
                    d.setDate(d.getDate() + i);
                    return { date: d, index: i };
                }
            }
            if (hdCells.length > 0) {
                const firstRect = hdCells[0].getBoundingClientRect();
                const lastRect  = hdCells[hdCells.length - 1].getBoundingClientRect();
                if (clientX < firstRect.left) {
                    return { date: new Date(ws), index: 0 };
                }
                if (clientX > lastRect.right) {
                    const d = new Date(ws);
                    d.setDate(d.getDate() + hdCells.length - 1);
                    return { date: d, index: hdCells.length - 1 };
                }
            }
            return null;
        };

        const highlightDropCol = (colIndex) => {
            const hdCells = header.querySelectorAll('.kt-gantt-hd-cell');
            hdCells.forEach((c, idx) => c.classList.toggle('kt-drop-hover', idx === colIndex));

            const rows = body.querySelectorAll('.kt-gantt-row');
            rows.forEach(r => {
                const cells = r.querySelectorAll('.kt-gantt-cell');
                cells.forEach((c, idx) => c.classList.toggle('kt-drop-hover', idx === colIndex));
            });
        };

        const clearDropHighlights = () => {
            header.querySelectorAll('.kt-gantt-hd-cell').forEach(c => c.classList.remove('kt-drop-hover'));
            body.querySelectorAll('.kt-gantt-cell').forEach(c => c.classList.remove('kt-drop-hover'));
        };

        ganttSection.addEventListener('dragover', (e) => {
            if (!this.draggedCard) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dayInfo = getDayFromClientX(e.clientX);
            if (dayInfo) {
                highlightDropCol(dayInfo.index);
            }
        });

        ganttSection.addEventListener('dragleave', (e) => {
            if (!ganttSection.contains(e.relatedTarget)) {
                clearDropHighlights();
            }
        });

        ganttSection.addEventListener('drop', async (e) => {
            if (!this.draggedCard) return;
            e.preventDefault();
            clearDropHighlights();

            const dayInfo = getDayFromClientX(e.clientX);
            if (dayInfo && this.draggedCard) {
                const card = this.draggedCard;
                this.draggedCard = null;
                const targetDate = startOfDay(dayInfo.date);
                await this.persistDateRange(card, targetDate, targetDate);
                await this.refresh();
            }
        });

        // --- BACKLOG DRAWER (RESIZABLE & COLLAPSIBLE KANBAN LANES) ---
        this.renderBacklogDrawer(container, unscheduled);
    }

    renderGanttRow(parent, card, ws, daysDisplayed = 14) {
        const row = parent.createDiv('kt-gantt-row');

        // Label column (sticky left, ultra-compact inline)
        const lbl = row.createDiv('kt-gantt-lbl');
        lbl.style.setProperty('--proj-color', card.tagColor || card.projectColor || 'transparent');
        if (card.priorityColor) lbl.style.setProperty('--prio-color', card.priorityColor);

        // Click no label abre opções do card
        lbl.style.cursor = 'pointer';
        lbl.title = `${card.title} — clique para opções`;
        lbl.onclick = () => this.openCardOptionsModal(card);

        // Title inline
        const titleEl = lbl.createDiv('kt-c-title');
        titleEl.setText(card.title);

        // Tags inline
        if (card.tags && card.tags.length > 0) {
            this.renderTagPills(lbl, card.tags, true);
        }

        // Status badge: Timeblock coverage indicator (inline)
        const tbStatus = getCardTimeblockStatus(card);
        if (tbStatus.totalDays > 0) {
            const badge = lbl.createSpan('kt-tb-status-badge');
            if (tbStatus.isFullyTimeblocked) {
                badge.addClass('kt-tb-complete');
                badge.setText(`${tbStatus.timeblockedDays}/${tbStatus.totalDays}`);
                badge.title = `Timeblocking completo: todos os ${tbStatus.totalDays} dias têm horários definidos`;
            } else if (tbStatus.timeblockedDays > 0) {
                badge.addClass('kt-tb-partial');
                badge.setText(`${tbStatus.timeblockedDays}/${tbStatus.totalDays}`);
                badge.title = `Timeblocking parcial: ${tbStatus.timeblockedDays} de ${tbStatus.totalDays} dias com horários`;
            } else {
                badge.addClass('kt-tb-empty');
                badge.setText(`0/${tbStatus.totalDays}`);
                badge.title = `Nenhum horário definido no Timeblocking ainda`;
            }
        }

        // Day cells
        const cells = row.createDiv('kt-gantt-cells');
        const cardStart = startOfDay(card.startDate);
        const cardEnd   = endOfDay(card.endDate || card.startDate);

        const cellElements = [];
        const cellDates    = [];

        for (let i = 0; i < daysDisplayed; i++) {
            const d    = new Date(ws); d.setDate(d.getDate() + i);
            const ds   = startOfDay(d);
            const cell = cells.createDiv('kt-gantt-cell');
            cell.dataset.dateIndex = String(i);
            cellElements.push(cell);
            cellDates.push(d);

            if (sameDay(d, new Date())) cell.addClass('kt-is-today');
            if (d.getDay() === 0 || d.getDay() === 6) cell.addClass('kt-is-weekend');

            if (ds >= cardStart && ds <= cardEnd) {
                cell.addClass('kt-span');
                cell.style.setProperty('--span-color', card.projectColor);

                const dayTime = getTimeForDay(card, d);
                if (dayTime && dayTime.timeStart && dayTime.timeEnd) {
                    cell.addClass('kt-span-timeblocked');
                    const ind = cell.createSpan('kt-span-tb-indicator');
                    ind.setText(`${dayTime.timeStart}–${dayTime.timeEnd}`);
                    cell.title = `${card.title} (${formatDate(card.startDate)} – ${formatDate(card.endDate || card.startDate)})\nHorário em ${this.dayLabel(d)}: ${dayTime.timeStart} – ${dayTime.timeEnd}`;
                } else {
                    cell.addClass('kt-span-not-timeblocked');
                    cell.title = `${card.title} (${formatDate(card.startDate)} – ${formatDate(card.endDate || card.startDate)})\nSem horário no Timeblocking para ${this.dayLabel(d)}`;
                }

                const isFirst = sameDay(ds, cardStart);
                const isLast  = sameDay(ds, cardEnd) || sameDay(ds, new Date(card.endDate || card.startDate));

                if (isFirst) {
                    cell.addClass('kt-span-first');
                    // Handle de redimensionamento da borda esquerda (início)
                    const leftHandle = cell.createDiv('kt-resize-edge kt-resize-edge-start');
                    leftHandle.title = 'Arraste para alterar o dia inicial';
                    this.attachGanttResize(leftHandle, 'start', card, ws, cellDates, cellElements, row);
                }

                if (isLast) {
                    cell.addClass('kt-span-last');
                    // Handle de redimensionamento da borda direita (término)
                    const rightHandle = cell.createDiv('kt-resize-edge kt-resize-edge-end');
                    rightHandle.title = 'Arraste para alterar o dia final';
                    this.attachGanttResize(rightHandle, 'end', card, ws, cellDates, cellElements, row);
                }

                // Drag do bloco inteiro horizontalmente ou clique para editar datas
                this.attachGanttSpanMove(cell, card, ws, cellDates, cellElements, row, i);
            } else {
                cell.title = `Clique duas vezes para abrir ${this.dayLabel(d)} no Timeblocking`;
                cell.ondblclick = () => {
                    this.openDayInTimeblocking(d);
                };
            }
        }
    }

    updateGanttRowVisual(cellElements, cellDates, card, pStart, pEnd, dayShift = 0) {
        cellElements.forEach((cell, i) => {
            const d = startOfDay(cellDates[i]);
            const inSpan = d.getTime() >= pStart.getTime() && d.getTime() <= pEnd.getTime();
            const isFirst = inSpan && sameDay(d, pStart);
            const isLast  = inSpan && sameDay(d, pEnd);

            cell.classList.toggle('kt-span', inSpan);
            cell.classList.toggle('kt-span-first', isFirst);
            cell.classList.toggle('kt-span-last', isLast);

            // Clean up any old preview child elements
            const oldBadge = cell.querySelector('.kt-span-tb-indicator');
            if (oldBadge) oldBadge.remove();
            const oldStartHandle = cell.querySelector('.kt-resize-edge-start');
            if (oldStartHandle) oldStartHandle.remove();
            const oldEndHandle = cell.querySelector('.kt-resize-edge-end');
            if (oldEndHandle) oldEndHandle.remove();

            if (inSpan) {
                cell.style.setProperty('--span-color', card.projectColor);

                // Check timeblock for this shifted date
                const origDate = new Date(d);
                if (dayShift !== 0) {
                    origDate.setDate(origDate.getDate() - dayShift);
                }
                const dayTime = getTimeForDay(card, origDate);

                if (dayTime && dayTime.timeStart && dayTime.timeEnd) {
                    cell.classList.add('kt-span-timeblocked');
                    cell.classList.remove('kt-span-not-timeblocked');
                    const ind = cell.createSpan('kt-span-tb-indicator');
                    ind.setText(`${dayTime.timeStart}–${dayTime.timeEnd}`);
                } else {
                    cell.classList.remove('kt-span-timeblocked');
                    cell.classList.add('kt-span-not-timeblocked');
                }

                if (isFirst) {
                    cell.createDiv('kt-resize-edge kt-resize-edge-start');
                }
                if (isLast) {
                    cell.createDiv('kt-resize-edge kt-resize-edge-end');
                }
            } else {
                cell.classList.remove('kt-span-timeblocked');
                cell.classList.remove('kt-span-not-timeblocked');
                cell.style.removeProperty('--span-color');
            }
        });
    }

    attachGanttSpanMove(cellEl, card, ws, cellDates, cellElements, row, originIndex) {
        cellEl.addEventListener('pointerdown', (e) => {
            if (e.target.classList.contains('kt-resize-edge')) return;
            if (e.button !== 0) return;

            const currentStart = startOfDay(card.startDate);
            const currentEnd   = startOfDay(card.endDate || card.startDate);
            const durationDays = Math.round((currentEnd.getTime() - currentStart.getTime()) / 86400000);

            const startX = e.clientX;
            const originDate = startOfDay(cellDates[originIndex]);
            let previewStart = new Date(currentStart);
            let previewEnd   = new Date(currentEnd);
            let dayShift     = 0;
            let hasMoved     = false;

            const onPointerMove = (moveEvt) => {
                const deltaX = moveEvt.clientX - startX;
                if (Math.abs(deltaX) > 4) {
                    hasMoved = true;
                    document.body.classList.add('kt-is-resizing');

                    const target = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
                    const cell = target ? target.closest('.kt-gantt-cell') : null;

                    if (cell && cell.dataset.dateIndex !== undefined) {
                        const idx = parseInt(cell.dataset.dateIndex, 10);
                        const hoveredDate = startOfDay(cellDates[idx]);
                        
                        dayShift = Math.round((hoveredDate.getTime() - originDate.getTime()) / 86400000);
                        
                        const newStart = new Date(currentStart);
                        newStart.setDate(newStart.getDate() + dayShift);
                        
                        const newEnd = new Date(newStart);
                        newEnd.setDate(newEnd.getDate() + durationDays);

                        previewStart = newStart;
                        previewEnd   = newEnd;

                        this.updateGanttRowVisual(cellElements, cellDates, card, previewStart, previewEnd, dayShift);
                    }
                }
            };

            const onPointerUp = async (upEvt) => {
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.body.classList.remove('kt-is-resizing');

                if (hasMoved) {
                    if (!sameDay(previewStart, card.startDate) || !sameDay(previewEnd, card.endDate || card.startDate)) {
                        await this.persistShiftedDateRange(card, previewStart, previewEnd, dayShift);
                        await this.refresh();
                    } else {
                        await this.refresh();
                    }
                } else {
                    this.openDateRangeModal(card);
                }
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });
    }

    async persistShiftedDateRange(card, newStart, newEnd, dayShift) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);
        
        // 1. Atualiza intervalo @{DD-MM-YYYY..DD-MM-YYYY}
        content = this.parser.updateDateRange(content, card.lineIndex, newStart, newEnd);
        
        // 2. Se houver dailyTimes, move os blocos de horário junto com o deslocamento de dias
        if (dayShift !== 0 && card.dailyTimes && Object.keys(card.dailyTimes).length > 0) {
            const oldKeys = Object.keys(card.dailyTimes);
            for (const oldKey of oldKeys) {
                const oldDt = card.dailyTimes[oldKey];
                const oldDate = parseDate(oldKey);
                if (oldDate) {
                    const shiftedDate = new Date(oldDate);
                    shiftedDate.setDate(shiftedDate.getDate() + dayShift);
                    content = this.parser.updateTimeBlock(content, card.lineIndex, oldDate, null, null);
                    content = this.parser.updateTimeBlock(content, card.lineIndex, shiftedDate, oldDt.timeStart, oldDt.timeEnd);
                }
            }
        }
        
        await this.app.vault.modify(file, content);
        new obsidian.Notice(`${card.title} → ${formatDate(newStart)}${sameDay(newStart, newEnd) ? '' : ' – ' + formatDate(newEnd)}`);
    }

    attachGanttResize(handleEl, edgeType, card, ws, cellDates, cellElements, row) {
        handleEl.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const currentStart = startOfDay(card.startDate);
            const currentEnd   = startOfDay(card.endDate || card.startDate);
            let previewStart = new Date(currentStart);
            let previewEnd   = new Date(currentEnd);
            let hasMoved     = false;

            document.body.classList.add('kt-is-resizing');

            const onPointerMove = (moveEvt) => {
                hasMoved = true;
                const target = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
                const cell = target ? target.closest('.kt-gantt-cell') : null;

                if (cell && cell.dataset.dateIndex !== undefined) {
                    const idx = parseInt(cell.dataset.dateIndex, 10);
                    const hoveredDate = startOfDay(cellDates[idx]);

                    if (edgeType === 'start') {
                        if (hoveredDate.getTime() <= currentEnd.getTime()) {
                            previewStart = hoveredDate;
                            previewEnd   = currentEnd;
                        } else {
                            previewStart = currentEnd;
                            previewEnd   = hoveredDate;
                        }
                    } else { // 'end'
                        if (hoveredDate.getTime() >= currentStart.getTime()) {
                            previewStart = currentStart;
                            previewEnd   = hoveredDate;
                        } else {
                            previewStart = hoveredDate;
                            previewEnd   = currentStart;
                        }
                    }

                    this.updateGanttRowVisual(cellElements, cellDates, card, previewStart, previewEnd, 0);
                }
            };

            const onPointerUp = async (upEvt) => {
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.body.classList.remove('kt-is-resizing');

                if (hasMoved) {
                    if (!sameDay(previewStart, card.startDate) || !sameDay(previewEnd, card.endDate || card.startDate)) {
                        await this.persistDateRange(card, previewStart, previewEnd);
                        await this.refresh();
                    } else {
                        await this.refresh();
                    }
                }
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });
    }

    async addCardToColumn(columnName, cardTitle) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);
        content = this.parser.addCardToColumn(content, columnName, cardTitle);
        await this.app.vault.modify(file, content);
        new obsidian.Notice(`➕ Card adicionado em "${columnName}"`);
    }

    async addColumnToKanban(columnName) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);
        const lines = content.split('\n');

        // Insert before the %% kanban:settings section if it exists, otherwise at the end
        const settingsIdx = lines.findIndex(l => /^%%\s*kanban:settings/i.test(l.trim()));
        if (settingsIdx !== -1) {
            lines.splice(settingsIdx, 0, '', `## ${columnName}`, '');
        } else {
            lines.push('', `## ${columnName}`, '');
        }

        await this.app.vault.modify(file, lines.join('\n'));
    }

    async deleteColumnFromKanban(columnName) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);
        content = this.parser.deleteColumn(content, columnName);
        await this.app.vault.modify(file, content);

        // Clean up settings
        if (this.plugin.settings.hiddenColumns) {
            this.plugin.settings.hiddenColumns = this.plugin.settings.hiddenColumns.filter(c => c !== columnName);
        }
        if (this.plugin.settings.collapsedColumns) {
            this.plugin.settings.collapsedColumns = this.plugin.settings.collapsedColumns.filter(c => c !== columnName);
        }
        if (this.plugin.settings.columnColors && this.plugin.settings.columnColors[columnName]) {
            delete this.plugin.settings.columnColors[columnName];
        }
        await this.plugin.saveSettings();
        new obsidian.Notice(`Coluna "${columnName}" excluída`);
        await this.refresh();
    }

    async reorderKanbanColumn(draggedColName, targetColName, isAfter) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;

        const allCols = [...this.columns];
        const findColIdx = (cols, name) => {
            if (!name) return -1;
            const clean = name.trim().toLowerCase().replace(/[\s-_]+/g, '');
            return cols.findIndex(c => c.trim().toLowerCase().replace(/[\s-_]+/g, '') === clean);
        };

        const draggedIdx = findColIdx(allCols, draggedColName);
        if (draggedIdx === -1) return;

        const targetIdx = findColIdx(allCols, targetColName);
        if (targetIdx === -1) return;

        // Actual column name as stored in array
        const realDraggedCol = allCols[draggedIdx];
        const realTargetCol = allCols[targetIdx];

        // Remove dragged column from current list
        allCols.splice(draggedIdx, 1);

        // Find destination in the modified array
        let insertIdx = findColIdx(allCols, realTargetCol);
        if (insertIdx === -1) {
            allCols.push(realDraggedCol);
        } else {
            if (isAfter) {
                insertIdx += 1;
            }
            allCols.splice(insertIdx, 0, realDraggedCol);
        }

        let content = await this.app.vault.read(file);
        content = this.parser.reorderColumns(content, allCols);
        await this.app.vault.modify(file, content);
        new obsidian.Notice(`Coluna "${realDraggedCol}" reordenada`);
        await this.refresh();
    }

    async toggleCardCompletion(card) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);

        if (!card.isCompleted) {
            // Completing the task: mark as [x] and move to Done column
            const doneCol = getDoneColumnName(this.columns);
            content = this.parser.toggleCardCompletion(content, card.lineIndex);

            if (!isDoneColumn(card.column)) {
                content = this.parser.moveCardToColumn(content, card.lineIndex, doneCol);
                new obsidian.Notice(`✓ ${card.title} concluído e movido para ${doneCol}`);
            } else {
                new obsidian.Notice(`✓ ${card.title} concluído`);
            }
        } else {
            // Reopening the task: mark as [ ]
            content = this.parser.toggleCardCompletion(content, card.lineIndex);
            new obsidian.Notice(`○ ${card.title} reaberto`);
        }

        await this.app.vault.modify(file, content);
        await this.refresh();
    }

    async moveCardToColumn(card, targetColumnName, targetLineIndex = -1) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);
        content = this.parser.moveCardToColumn(content, card.lineIndex, targetColumnName, targetLineIndex);
        await this.app.vault.modify(file, content);
        new obsidian.Notice(`Card movido → ${targetColumnName}`);
    }

    async moveCardRelative(sourceCard, targetCard, position) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;
        let content = await this.app.vault.read(file);
        content = this.parser.moveCardRelative(content, sourceCard.lineIndex, targetCard.lineIndex, position);
        await this.app.vault.modify(file, content);
    }

    // ----------------------------------------------------------
    // PROJECTS & WORKLOAD TIME METRICS VIEW
    // ----------------------------------------------------------

    renderProjectsView(container) {
        const wrap = container.createDiv('kt-projects-view');

        // 1. Projects Top Bar
        const topBar = wrap.createDiv('kt-proj-topbar');

        const headerInfo = topBar.createDiv('kt-proj-header-info');
        headerInfo.createEl('h2', { cls: 'kt-proj-main-title', text: '📁 Projetos & Métricas de Tempo' });
        
        // Calculate Global Totals across all projects
        const projects = this.plugin.settings.projects || [];
        let globalPastMinutes = 0;
        let globalFutureMinutes = 0;
        let globalTasksCount = 0;
        let globalDoneCount = 0;
        let globalEarnings = 0;
        let hasAnyHourlyRate = false;

        const projStatsList = projects.map(p => {
            const stats = this.calculateProjectStats(p, this.cards, this.projectsPeriodFilter || 'all');
            globalPastMinutes += stats.pastMinutes;
            globalFutureMinutes += stats.futureMinutes;
            globalTasksCount += stats.totalTasks;
            globalDoneCount += stats.doneTasks;
            if (p.hourlyRate > 0) {
                hasAnyHourlyRate = true;
                globalEarnings += (stats.pastMinutes / 60) * p.hourlyRate;
            }
            return { project: p, stats };
        });

        const globalPastHours = formatMinutesToHours(globalPastMinutes) || '0h';
        const globalFutureHours = formatMinutesToHours(globalFutureMinutes) || '0h';
        let subtitleText = `${projects.length} Projetos monitorados • ${globalPastHours} realizadas até hoje (+${globalFutureHours} agendadas no futuro)`;
        if (hasAnyHourlyRate) {
            subtitleText += ` • 💵 Total ganho: ${formatCurrency(globalEarnings, 'R$')}`;
        }
        headerInfo.createEl('p', {
            cls: 'kt-proj-subtitle',
            text: subtitleText
        });

        // Top Actions (Period Filter + New Project Button)
        const topActions = topBar.createDiv('kt-proj-top-actions');

        const filterGroup = topActions.createDiv('kt-proj-filter-group');
        const filters = [
            { id: 'all', label: 'Tudo' },
            { id: 'week', label: 'Esta Semana' },
            { id: 'month', label: 'Este Mês' },
            { id: 'today', label: 'Hoje' },
        ];
        const activeFilter = this.projectsPeriodFilter || 'all';

        filters.forEach(f => {
            const fBtn = filterGroup.createEl('button', {
                cls: `kt-proj-filter-btn ${activeFilter === f.id ? 'is-active' : ''}`,
                text: f.label
            });
            fBtn.onclick = () => {
                this.projectsPeriodFilter = f.id;
                this.render();
            };
        });

        const newProjBtn = topActions.createEl('button', {
            cls: 'kt-btn-new-project mod-cta',
            text: '＋ Novo Projeto'
        });
        newProjBtn.onclick = () => {
            new ProjectModal(this.app, this.plugin, null, this.columns, async (newP) => {
                if (!this.plugin.settings.projects) this.plugin.settings.projects = [];
                this.plugin.settings.projects.push(newP);
                await this.plugin.saveSettings();
                await this.refresh();
                new obsidian.Notice(`Projeto "${newP.name}" criado!`);
            }).open();
        };

        // 2. Global KPI Summary Cards (Separando Realizado de Futuro e Ganhos)
        const kpiRow = wrap.createDiv('kt-proj-kpi-row');

        const kpi1 = kpiRow.createDiv('kt-proj-kpi-box');
        kpi1.createDiv('kt-kpi-val').setText(globalPastHours);
        kpi1.createDiv('kt-kpi-lbl').setText('⏱ Tempo Realizado (Até Hoje)');

        const kpi2 = kpiRow.createDiv('kt-proj-kpi-box');
        kpi2.createDiv('kt-kpi-val').setText(globalFutureHours);
        kpi2.createDiv('kt-kpi-lbl').setText('📅 Tempo Futuro Agendado');

        const pct = globalTasksCount > 0 ? Math.round((globalDoneCount / globalTasksCount) * 100) : 0;
        const kpi3 = kpiRow.createDiv('kt-proj-kpi-box');
        kpi3.createDiv('kt-kpi-val').setText(`${globalDoneCount} / ${globalTasksCount} (${pct}%)`);
        kpi3.createDiv('kt-kpi-lbl').setText('✅ Tarefas Concluídas');

        if (hasAnyHourlyRate) {
            const kpi4 = kpiRow.createDiv('kt-proj-kpi-box kt-kpi-earnings');
            kpi4.createDiv('kt-kpi-val').setText(formatCurrency(globalEarnings, 'R$'));
            kpi4.createDiv('kt-kpi-lbl').setText('💵 Ganhos Realizados (Total)');
        }

        // 3. Projects Cards Grid
        const grid = wrap.createDiv('kt-proj-grid');

        if (projStatsList.length === 0) {
            const empty = grid.createDiv('kt-proj-empty');
            empty.setText('Nenhum projeto cadastrado.');
            empty.createEl('p', { text: 'Clique em "+ Novo Projeto" para adicionar seus projetos e acompanhar as horas automaticamente.' });
            return;
        }

        projStatsList.forEach(({ project, stats }, index) => {
            this.renderProjectCard(grid, project, stats, index);
        });

        // 4. ActivityWatch Section (Scrollable bottom area)
        this.renderActivityWatchSection(wrap);
    }

    calculateProjectStats(project, cards, periodFilter = 'all') {
        const projTag = (project.tag || '').trim().toLowerCase().replace(/^#/, '');
        const projCols = (project.columns || []).map(c => c.toLowerCase());
        const excludedSet = new Set(project.excludedTaskTitles || []);

        const matchingCards = cards.filter(c => {
            if (c.isEvent || c.column === 'Rotina') return false;
            const hasTag = projTag && c.tags.some(t => t.toLowerCase().replace(/^#/, '') === projTag);
            const inCol  = projCols.length > 0 && projCols.includes((c.column || '').toLowerCase());
            const hasTitleTag = projTag && c.title.toLowerCase().includes('#' + projTag);
            return hasTag || inCol || hasTitleTag;
        });

        let pastMinutes = 0;   // Realizadas (Hoje para trás)
        let futureMinutes = 0; // Agendadas (Dias futuros)
        let doneMinutes = 0;
        let inDevMinutes = 0;
        let backlogMinutes = 0;

        let doneTasks = 0;
        let inDevTasks = 0;
        let backlogTasks = 0;

        const now = new Date();
        const today = startOfDay(now);

        const startOfThisWeek = this.getWeekStart();
        const endOfThisWeek = new Date(startOfThisWeek);
        endOfThisWeek.setDate(endOfThisWeek.getDate() + 7);

        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const cardTimeSessions = [];

        matchingCards.forEach(c => {
            const isDone = c.isCompleted || c.column === 'Done' || isIgnoredColumn(c.column);
            const isInDev = (c.column || '').toLowerCase().includes('indev') || (c.column || '').toLowerCase().includes('in development') || (c.column || '').toLowerCase() === 'this week';
            const isExcluded = excludedSet.has(c.title.trim());

            if (isDone) doneTasks++;
            else if (isInDev) inDevTasks++;
            else backlogTasks++;

            // If excluded by user toggle, skip counting hours for this task
            if (isExcluded) return;

            const dKeys = Object.keys(c.dailyTimes || {});

            if (dKeys.length > 0) {
                for (const dKey of dKeys) {
                    const dt = c.dailyTimes[dKey];
                    const slotDate = parseDate(dKey);
                    
                    if (slotDate) {
                        if (periodFilter === 'today' && !sameDay(slotDate, now)) continue;
                        if (periodFilter === 'week' && (slotDate < startOfThisWeek || slotDate >= endOfThisWeek)) continue;
                        if (periodFilter === 'month' && (slotDate < startOfMonth || slotDate > endOfMonth)) continue;
                    }

                    if (dt.timeStart && dt.timeEnd) {
                        const dur = timeToMinutes(dt.timeEnd) - timeToMinutes(dt.timeStart);
                        if (dur > 0) {
                            const isFutureSlot = slotDate ? startOfDay(slotDate).getTime() > today.getTime() : false;
                            if (isDone) {
                                pastMinutes += dur;
                                doneMinutes += dur;
                            } else if (isFutureSlot) {
                                futureMinutes += dur;
                            } else {
                                if (isInDev) inDevMinutes += dur;
                                else backlogMinutes += dur;
                            }

                            cardTimeSessions.push({
                                cardTitle: c.title,
                                date: dKey,
                                timeStart: dt.timeStart,
                                timeEnd: dt.timeEnd,
                                durationMinutes: dur,
                                isFuture: isFutureSlot && !isDone,
                                isDone
                            });
                        }
                    }
                }
            } else if (c.timeStart && c.timeEnd) {
                const dur = timeToMinutes(c.timeEnd) - timeToMinutes(c.timeStart);
                if (dur > 0) {
                    const cardDate = c.startDate ? startOfDay(c.startDate) : null;
                    const isFutureSlot = cardDate ? cardDate.getTime() > today.getTime() : false;
                    
                    if (isDone) {
                        pastMinutes += dur;
                        doneMinutes += dur;
                    } else if (isFutureSlot) {
                        futureMinutes += dur;
                    } else {
                        if (isInDev) inDevMinutes += dur;
                        else backlogMinutes += dur;
                    }

                    cardTimeSessions.push({
                        cardTitle: c.title,
                        date: c.startDate ? formatDate(c.startDate) : 'Geral',
                        timeStart: c.timeStart,
                        timeEnd: c.timeEnd,
                        durationMinutes: dur,
                        isFuture: isFutureSlot && !isDone,
                        isDone
                    });
                }
            } else if (c.estimateMinutes && c.estimateMinutes > 0) {
                if (periodFilter === 'all') {
                    const cardDate = c.startDate ? startOfDay(c.startDate) : null;
                    const isFutureSlot = cardDate ? cardDate.getTime() > today.getTime() : false;
                    if (isDone) {
                        pastMinutes += c.estimateMinutes;
                        doneMinutes += c.estimateMinutes;
                    } else if (isFutureSlot) {
                        futureMinutes += c.estimateMinutes;
                    } else {
                        if (isInDev) inDevMinutes += c.estimateMinutes;
                        else backlogMinutes += c.estimateMinutes;
                    }
                }
            }
        });

        const totalTasks = matchingCards.length;
        const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

        return {
            matchingCards,
            totalTasks,
            doneTasks,
            inDevTasks,
            backlogTasks,
            pastMinutes,
            futureMinutes,
            totalMinutes: pastMinutes, // Primary total hours is past/today!
            doneMinutes,
            inDevMinutes,
            backlogMinutes,
            completionRate,
            cardTimeSessions
        };
    }

    renderProjectCard(parent, project, stats, index) {
        const card = parent.createDiv('kt-proj-card');
        card.style.setProperty('--proj-card-color', project.color || '#6366f1');
        card.setAttribute('draggable', 'true');
        card.dataset.projId = project.id;
        card.dataset.projIndex = String(index);

        // Drag & Drop Reordering Handlers
        card.addEventListener('dragstart', (e) => {
            if (e.target.closest('button, input, .kt-proj-task-check, .kt-proj-task-title, .kt-proj-task-toggle-btn')) {
                e.preventDefault();
                return;
            }
            e.dataTransfer.setData('text/plain', project.id);
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('kt-is-dragging');
            this._draggedProjId = project.id;
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('kt-is-dragging');
            document.querySelectorAll('.kt-proj-card').forEach(el => {
                el.classList.remove('kt-drag-over-left', 'kt-drag-over-right');
            });
            this._draggedProjId = null;
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!this._draggedProjId || this._draggedProjId === project.id) return;

            const rect = card.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            const isLeft = e.clientX < midX;

            card.classList.toggle('kt-drag-over-left', isLeft);
            card.classList.toggle('kt-drag-over-right', !isLeft);
        });

        card.addEventListener('dragleave', () => {
            card.classList.remove('kt-drag-over-left', 'kt-drag-over-right');
        });

        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            card.classList.remove('kt-drag-over-left', 'kt-drag-over-right');
            const draggedId = e.dataTransfer.getData('text/plain') || this._draggedProjId;
            if (!draggedId || draggedId === project.id) return;

            const projects = this.plugin.settings.projects || [];
            const srcIdx = projects.findIndex(p => p.id === draggedId);
            const targetIdx = projects.findIndex(p => p.id === project.id);

            if (srcIdx === -1 || targetIdx === -1) return;

            const rect = card.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            const insertBefore = e.clientX < midX;

            const [movedProj] = projects.splice(srcIdx, 1);
            let newTargetIdx = projects.findIndex(p => p.id === project.id);
            if (!insertBefore) {
                newTargetIdx += 1;
            }
            projects.splice(newTargetIdx, 0, movedProj);

            this.plugin.settings.projects = projects;
            await this.plugin.saveSettings();
            this.render();
        });

        // 1. Header
        const hdr = card.createDiv('kt-proj-card-header');
        
        const leftHdr = hdr.createDiv('kt-proj-card-title-group');
        leftHdr.style.cursor = 'pointer';
        leftHdr.title = 'Clique para abrir o discriminado de horas, tarefas e datas deste projeto';
        leftHdr.onclick = () => {
            new ProjectReportModal(this.app, this.plugin, project, this.cards, this).open();
        };

        const colorDot = leftHdr.createSpan('kt-proj-color-dot');
        colorDot.style.backgroundColor = project.color || '#6366f1';

        leftHdr.createEl('h3', { cls: 'kt-proj-card-name', text: project.name });

        if (project.tag) {
            const tagPill = leftHdr.createSpan('kt-proj-tag-pill');
            tagPill.setText(project.tag);
        }

        const actions = hdr.createDiv('kt-proj-card-actions');

        const reportBtn = actions.createEl('button', { cls: 'kt-proj-action-btn kt-proj-report-btn', text: '📋' });
        reportBtn.title = 'Gerar discriminado de tarefas, horas e datas para enviar ao chefe';
        reportBtn.onclick = (e) => {
            e.stopPropagation();
            new ProjectReportModal(this.app, this.plugin, project, this.cards, this).open();
        };

        const editBtn = actions.createEl('button', { cls: 'kt-proj-action-btn', text: '✎' });
        editBtn.title = 'Editar Projeto';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            new ProjectModal(
                this.app,
                this.plugin,
                project,
                this.columns,
                async (updated) => {
                    const idx = this.plugin.settings.projects.findIndex(p => p.id === project.id);
                    if (idx !== -1) {
                        this.plugin.settings.projects[idx] = updated;
                        await this.plugin.saveSettings();
                        await this.refresh();
                        new obsidian.Notice(`Projeto "${updated.name}" atualizado!`);
                    }
                },
                async () => {
                    this.plugin.settings.projects = this.plugin.settings.projects.filter(p => p.id !== project.id);
                    await this.plugin.saveSettings();
                    await this.refresh();
                    new obsidian.Notice(`Projeto "${project.name}" removido.`);
                }
            ).open();
        };

        // 2. Big Main Hours Metric (Horas Realizadas até Hoje)
        const hoursBox = card.createDiv('kt-proj-main-hours');
        hoursBox.style.cursor = 'pointer';
        hoursBox.title = 'Clique para abrir o discriminado completo de horas';
        hoursBox.onclick = () => {
            new ProjectReportModal(this.app, this.plugin, project, this.cards, this).open();
        };
        const formattedPast = formatMinutesToHours(stats.pastMinutes) || '0h';
        hoursBox.createSpan({ cls: 'kt-proj-hours-val', text: formattedPast });
        hoursBox.createSpan({ cls: 'kt-proj-hours-lbl', text: 'realizadas (até hoje)' });

        // 3. Meta Badges Container (Futuro, Ganhos, Meta)
        const metaBadges = card.createDiv('kt-proj-meta-badges');

        // Future scheduled badge if present
        if (stats.futureMinutes > 0) {
            const futureBadge = metaBadges.createDiv('kt-proj-future-badge');
            futureBadge.setText(`📅 +${formatMinutesToHours(stats.futureMinutes)} agendadas no futuro`);
            futureBadge.title = 'Horas planejadas para os próximos dias';
        }

        // Earnings (Ganhos com base no valor da hora)
        if (project.hourlyRate > 0) {
            const curr = project.currency || 'R$';
            const earnedAmount = (stats.pastMinutes / 60) * project.hourlyRate;
            const futureAmount = (stats.futureMinutes / 60) * project.hourlyRate;

            const earningsRow = metaBadges.createDiv('kt-proj-earnings-row');
            
            const mainEarnings = earningsRow.createDiv('kt-proj-earnings-main');
            mainEarnings.createSpan({ cls: 'kt-earnings-icon', text: '💵' });
            mainEarnings.createSpan({ cls: 'kt-earnings-val', text: formatCurrency(earnedAmount, curr) });
            mainEarnings.createSpan({ cls: 'kt-earnings-rate', text: `ganhos (${curr} ${project.hourlyRate}/h)` });

            if (stats.futureMinutes > 0 && futureAmount > 0) {
                const futureEarnings = earningsRow.createSpan('kt-earnings-future');
                futureEarnings.setText(`＋ ${formatCurrency(futureAmount, curr)} previsto`);
                futureEarnings.title = 'Valor estimado das horas agendadas no futuro';
            }
        }

        // Target hours indicator if set
        if (project.targetHours > 0) {
            const targetMin = project.targetHours * 60;
            const targetPct = Math.min(100, Math.round((stats.pastMinutes / targetMin) * 100));
            const targetEl = metaBadges.createDiv('kt-proj-target-row');
            targetEl.setText(`Meta: ${project.targetHours}h (${targetPct}% alcançado)`);
        }

        // 4. Progress Bar
        const progressWrap = card.createDiv('kt-proj-progress-wrap');
        const progressBar = progressWrap.createDiv('kt-proj-progress-bar');
        progressBar.style.width = `${stats.completionRate}%`;
        progressBar.style.backgroundColor = project.color || '#6366f1';

        // 5. Stats Matrix (Done, Futuro, Backlog)
        const statsRow = card.createDiv('kt-proj-stats-row');

        const stat1 = statsRow.createDiv('kt-proj-stat');
        stat1.createSpan({ cls: 'kt-stat-n', text: `${stats.doneTasks}` });
        stat1.createSpan({ cls: 'kt-stat-l', text: `Feitas (${formatMinutesToHours(stats.doneMinutes) || '0h'})` });

        const stat2 = statsRow.createDiv('kt-proj-stat');
        stat2.createSpan({ cls: 'kt-stat-n', text: `${formatMinutesToHours(stats.futureMinutes) || '0h'}` });
        stat2.createSpan({ cls: 'kt-stat-l', text: 'Futuro Agendado' });

        const stat3 = statsRow.createDiv('kt-proj-stat');
        stat3.createSpan({ cls: 'kt-stat-n', text: `${stats.backlogTasks}` });
        stat3.createSpan({ cls: 'kt-stat-l', text: 'No Backlog' });

        // 6. Tasks Section (Always Visible & Scrollable)
        const tasksSection = card.createDiv('kt-proj-tasks-section');
        const tasksHeader = tasksSection.createDiv('kt-proj-tasks-header');
        tasksHeader.createSpan({ cls: 'kt-proj-th-title', text: `Tarefas (${stats.totalTasks})` });

        const tasksList = tasksSection.createDiv('kt-proj-tasks-list');
        if (stats.matchingCards.length === 0) {
            tasksList.createDiv('kt-proj-drawer-empty').setText('Nenhuma tarefa encontrada com esta hashtag ou coluna.');
        } else {
            stats.matchingCards.forEach(c => {
                const isDone = c.isCompleted || c.column === 'Done' || isIgnoredColumn(c.column);
                const isExcluded = (project.excludedTaskTitles || []).includes(c.title.trim());
                const isCountedInRealized = isDone && !isExcluded;

                const tItem = tasksList.createDiv(`kt-proj-task-item ${isDone ? 'is-done' : ''} ${isExcluded ? 'is-excluded' : ''} ${!isCountedInRealized ? 'not-counted' : ''}`);

                const left = tItem.createDiv('kt-proj-task-left');
                
                // Clickable completion checkbox on left
                const leftCheck = left.createSpan({ 
                    cls: `kt-proj-task-check ${isDone ? 'is-checked' : 'is-unchecked'}`, 
                    text: isDone ? '✓' : '○' 
                });
                leftCheck.title = isDone ? 'Tarefa concluída (clique para marcar como pendente)' : 'Tarefa pendente (clique para marcar como concluída)';
                leftCheck.onclick = async (e) => {
                    e.stopPropagation();
                    await this.toggleCardCompletion(c);
                    await this.refresh();
                };

                const titleSpan = left.createSpan({ cls: 'kt-proj-task-title', text: c.title });
                titleSpan.onclick = () => this.openCardOptionsModal(c);

                const right = tItem.createDiv('kt-proj-task-right');
                right.createSpan({ cls: 'kt-proj-task-col', text: c.column });
                
                // Calculate task's total time
                let taskDurMinutes = 0;
                const dKeys = Object.keys(c.dailyTimes || {});
                if (dKeys.length > 0) {
                    for (const dk of dKeys) {
                        const dt = c.dailyTimes[dk];
                        if (dt.timeStart && dt.timeEnd) {
                            const dur = timeToMinutes(dt.timeEnd) - timeToMinutes(dt.timeStart);
                            if (dur > 0) taskDurMinutes += dur;
                        }
                    }
                } else if (c.timeStart && c.timeEnd) {
                    const dur = timeToMinutes(c.timeEnd) - timeToMinutes(c.timeStart);
                    if (dur > 0) taskDurMinutes += dur;
                } else if (c.estimateMinutes) {
                    taskDurMinutes += c.estimateMinutes;
                }

                if (taskDurMinutes > 0) {
                    const timeSpan = right.createSpan({ cls: 'kt-proj-task-time', text: `⏱ ${formatMinutesToHours(taskDurMinutes)}` });
                    if (!isCountedInRealized) {
                        if (!isDone && isExcluded) timeSpan.title = 'Não contabilizado: tarefa pendente e desmarcada no seletor da direita';
                        else if (!isDone) timeSpan.title = 'Não contabilizado nos ganhos: tarefa pendente (precisa ser concluída ✓)';
                        else timeSpan.title = 'Não contabilizado nos ganhos: desmarcada no seletor da direita';
                    } else {
                        timeSpan.title = 'Contabilizado nas horas e ganhos realizados ✓';
                    }
                } else if (c.estimateText) {
                    right.createSpan({ cls: 'kt-proj-task-time', text: `⏱ ${c.estimateText}` });
                }

                // Minimalist Toggle Button on Far Right (Inclusão / Exclusão manual)
                const toggleBtn = right.createSpan({
                    cls: `kt-proj-task-toggle-btn ${!isExcluded ? 'is-included' : 'is-excluded'}`,
                    text: !isExcluded ? '✓' : '○'
                });
                toggleBtn.title = isExcluded
                    ? 'Desconsiderado do cálculo do projeto (clique para incluir)'
                    : 'Incluído no cálculo do projeto (clique para desconsiderar)';

                toggleBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (!project.excludedTaskTitles) project.excludedTaskTitles = [];
                    const titleKey = c.title.trim();
                    if (isExcluded) {
                        project.excludedTaskTitles = project.excludedTaskTitles.filter(t => t !== titleKey);
                    } else {
                        if (!project.excludedTaskTitles.includes(titleKey)) {
                            project.excludedTaskTitles.push(titleKey);
                        }
                    }
                    await this.plugin.saveSettings();
                    this.render();
                };
            });
        }
    }

    // ----------------------------------------------------------
    // ACTIVITY WATCH INTEGRATION (MONITORAMENTO EM TEMPO REAL)
    // ----------------------------------------------------------

    renderActivityWatchSection(container) {
        const sec = container.createDiv('kt-aw-section');

        // Divider
        const divider = sec.createDiv('kt-aw-divider');
        const dividerInner = divider.createDiv('kt-aw-divider-inner');
        dividerInner.createSpan({ cls: 'kt-aw-divider-icon', text: '⏱️' });
        dividerInner.createSpan({ cls: 'kt-aw-divider-text', text: 'ActivityWatch — Monitoramento em Tempo Real' });

        if (!this.plugin.settings.awConnected) {
            this.renderActivityWatchConnectBanner(sec);
        } else {
            this.renderActivityWatchDashboard(sec);
        }
    }

    renderActivityWatchConnectBanner(container) {
        const card = container.createDiv('kt-aw-connect-card');
        const iconWrap = card.createDiv('kt-aw-connect-icon-wrap');
        iconWrap.createSpan({ cls: 'kt-aw-connect-icon', text: '⚡' });

        const content = card.createDiv('kt-aw-connect-content');
        content.createEl('h3', { cls: 'kt-aw-connect-title', text: 'Conectar ao ActivityWatch' });
        content.createEl('p', {
            cls: 'kt-aw-connect-desc',
            text: 'Visualize as janelas, softwares mais usados (Unity, Rider, Obsidian, etc.), categorias inteligentes por projetos e gráficos sunburst/donut diretamente aqui no Kanban Timeline.'
        });

        const actions = card.createDiv('kt-aw-connect-actions');
        const connectBtn = actions.createEl('button', {
            cls: 'kt-aw-btn-connect mod-cta',
            text: '🔌 Conectar ao ActivityWatch'
        });

        const notice = actions.createSpan({
            cls: 'kt-aw-connect-notice',
            text: '🔒 O ActivityWatch roda localmente na porta 5600. Se você não utiliza o ActivityWatch, seus projetos e tarefas continuam funcionando normalmente.'
        });

        connectBtn.onclick = async () => {
            connectBtn.setText('⏳ Conectando...');
            connectBtn.disabled = true;
            await this.testAndConnectActivityWatch();
        };
    }

    async testAndConnectActivityWatch() {
        const host = this.plugin.settings.awHost || 'http://127.0.0.1:5600';
        try {
            const res = await obsidian.requestUrl({ url: `${host}/api/0/info` });
            if (res.status === 200) {
                this.plugin.settings.awConnected = true;
                await this.plugin.saveSettings();
                await this.loadActivityWatchData();
                this.render();
                new obsidian.Notice('Conectado ao ActivityWatch com sucesso! 🚀');
            } else {
                throw new Error(`Status ${res.status}`);
            }
        } catch (e) {
            console.error('[Kanban Timeline] Erro ao conectar ao ActivityWatch:', e);
            this.plugin.settings.awConnected = false;
            await this.plugin.saveSettings();
            this.render();
            new obsidian.Notice('Não foi possível conectar ao ActivityWatch na porta 5600. Verifique se o aplicativo está aberto.');
        }
    }

    async loadActivityWatchData() {
        if (!this.plugin.settings.awConnected) return;
        const host = this.plugin.settings.awHost || 'http://127.0.0.1:5600';
        const filter = this.awPeriodFilter || 'today';

        try {
            const [infoRes, settingsRes] = await Promise.all([
                obsidian.requestUrl({ url: `${host}/api/0/info` }),
                obsidian.requestUrl({ url: `${host}/api/0/settings` }).catch(e => ({ json: null }))
            ]);

            const hostname = infoRes.json?.hostname || 'localhost';
            const awClasses = settingsRes.json?.classes || [];

            const now = new Date();
            let startTime, endTime;
            const selected = this.awSelectedDate || now;

            if (filter === 'today') {
                this.awSelectedDate = new Date();
                startTime = startOfDay(now);
                endTime = new Date(startTime.getTime() + 86400000 - 1);
            } else if (filter === 'yesterday') {
                const yest = new Date(startOfDay(now).getTime() - 86400000);
                this.awSelectedDate = yest;
                startTime = startOfDay(yest);
                endTime = new Date(startTime.getTime() + 86400000 - 1);
            } else if (filter === 'date') {
                startTime = startOfDay(selected);
                endTime = new Date(startTime.getTime() + 86400000 - 1);
            } else if (filter === 'week') {
                startTime = this.getWeekStart();
                endTime = new Date(startTime.getTime() + 7 * 86400000 - 1);
            } else if (filter === 'month') {
                startTime = new Date(selected.getFullYear(), selected.getMonth(), 1);
                endTime = new Date(selected.getFullYear(), selected.getMonth() + 1, 0, 23, 59, 59);
            } else {
                startTime = startOfDay(now);
                endTime = new Date();
            }

            const startIso = startTime.toISOString();
            const endIso = endTime.toISOString();
            const winBucket = `aw-watcher-window_${hostname}`;
            const eventsUrl = `${host}/api/0/buckets/${winBucket}/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=-1`;
            
            const eventsRes = await obsidian.requestUrl({ url: eventsUrl });
            const windowEvents = eventsRes.json || [];

            const processed = this.processActivityWatchEvents(windowEvents, this.plugin.settings.projects, awClasses);

            this.awData = {
                hostname,
                startTime,
                endTime,
                windowEvents,
                awClasses,
                processed,
                lastUpdated: new Date()
            };
            await this.syncActivityWatchHabits();
        } catch (e) {
            console.error('[Kanban Timeline] Erro ao carregar dados do ActivityWatch:', e);
            this.awData = { error: e.message };
        }
    }

    processActivityWatchEvents(windowEvents, projects = [], awClasses = []) {
        let totalActiveSeconds = 0;
        const windowMap = new Map();
        const categoryMap = new Map();
        const appMap = new Map();
        const projectTrackedSeconds = {}; // projectId -> seconds

        // 1. Compile valid ActivityWatch class rules from /api/0/settings
        const compiledAWClasses = (awClasses || [])
            .filter(c => c.rule && c.rule.type === 'regex' && c.rule.regex && c.rule.regex !== 'FILL ME')
            .map(c => {
                let reg = null;
                try {
                    reg = new RegExp(c.rule.regex, c.rule.ignore_case !== false ? 'i' : '');
                } catch (e) {
                    console.warn('[Kanban Timeline] Invalid regex in AW class:', c.rule.regex, e);
                }
                return {
                    id: c.id,
                    nameArr: c.name || ['Uncategorized'],
                    fullName: (c.name || []).join(' > '),
                    shortName: (c.name || [])[(c.name || []).length - 1] || 'Uncategorized',
                    parent: (c.name || [])[0] || 'Uncategorized',
                    depth: (c.name || []).length,
                    regex: reg,
                    rawRegex: c.rule.regex,
                    color: c.data?.color || '#3b82f6'
                };
            })
            .filter(c => c.regex !== null)
            .sort((a, b) => b.depth - a.depth); // Deeper / more specific child rules matched first

        // 2. Project rules from Kanban Timeline
        const projectRules = (projects || []).map(p => {
            const customPatterns = (p.awPattern || '')
                .split(',')
                .map(s => s.trim().toLowerCase())
                .filter(Boolean);
            return {
                id: p.id,
                name: p.name,
                tag: (p.tag || '').replace(/^#/, '').toLowerCase(),
                nameLower: p.name.toLowerCase(),
                color: p.color || '#3b82f6',
                customPatterns
            };
        });

        function categorize(app, title) {
            const appL = (app || '').toLowerCase();
            const titleL = (title || '').toLowerCase();
            const fullTarget = `${app} ${title}`;

            // Step A: Match against user's live ActivityWatch category regex rules
            let matchedAW = null;
            for (const cls of compiledAWClasses) {
                if (cls.regex.test(fullTarget) || cls.regex.test(title) || cls.regex.test(app)) {
                    matchedAW = cls;
                    break;
                }
            }

            // Step B: Check correlation with Kanban Timeline projects
            for (const pr of projectRules) {
                let isProjectMatch = false;

                // Match by AW class name (e.g. "Work > Project" matches project "Project")
                if (matchedAW) {
                    const awLastName = matchedAW.shortName.toLowerCase();
                    const awFullName = matchedAW.fullName.toLowerCase();
                    if (
                        awLastName === pr.nameLower ||
                        awFullName.includes(pr.nameLower) ||
                        (pr.tag && awFullName.includes(pr.tag))
                    ) {
                        isProjectMatch = true;
                    }
                }

                // Match by custom patterns or tag in title/app
                if (!isProjectMatch) {
                    for (const pat of pr.customPatterns) {
                        try {
                            const reg = new RegExp(pat, 'i');
                            if (reg.test(titleL) || reg.test(appL)) {
                                isProjectMatch = true;
                                break;
                            }
                        } catch (e) {
                            if (titleL.includes(pat) || appL.includes(pat)) {
                                isProjectMatch = true;
                                break;
                            }
                        }
                    }

                    if (!isProjectMatch && (
                        (pr.tag && titleL.includes(pr.tag)) ||
                        (pr.nameLower && titleL.includes(pr.nameLower)) ||
                        (pr.tag && appL.includes(pr.tag))
                    )) {
                        isProjectMatch = true;
                    }
                }

                if (isProjectMatch) {
                    const categoryName = matchedAW ? matchedAW.fullName : `Work > ${pr.name}`;
                    const parentName = matchedAW ? matchedAW.parent : 'Work';
                    const shortName = pr.name;
                    return {
                        projectId: pr.id,
                        parent: parentName,
                        name: categoryName,
                        shortName: shortName,
                        color: pr.color || matchedAW?.color || '#3b82f6'
                    };
                }
            }

            // Step C: If matched an ActivityWatch category that is not a Kanban project (e.g. "Language Learning > Japonese" or "Media > Video")
            if (matchedAW) {
                return {
                    projectId: null,
                    parent: matchedAW.parent,
                    name: matchedAW.fullName,
                    shortName: matchedAW.shortName,
                    color: matchedAW.color || '#3b82f6'
                };
            }

            // Step D: Built-in smart fallbacks
            if (appL.includes('obsidian')) {
                return { parent: 'Obsidian', name: 'Obsidian', shortName: 'Obsidian', color: '#a855f7' };
            }
            if (
                appL.includes('whatsapp') ||
                appL.includes('telegram') ||
                appL.includes('discord') ||
                titleL.includes('youtube') ||
                titleL.includes('reddit') ||
                titleL.includes('twitter') ||
                titleL.includes('instagram') ||
                titleL.includes('twitch')
            ) {
                return { parent: 'Media', name: 'Media > Social Media', shortName: 'Social Media', color: '#22c55e' };
            }
            if (
                appL.includes('spotify') ||
                appL.includes('vlc') ||
                appL.includes('netflix')
            ) {
                return { parent: 'Media', name: 'Media > Video & Audio', shortName: 'Video & Audio', color: '#ec4899' };
            }
            if (
                appL.includes('unity') ||
                appL.includes('rider') ||
                appL.includes('code') ||
                appL.includes('visual studio') ||
                appL.includes('blender') ||
                appL.includes('godot') ||
                appL.includes('unreal') ||
                appL.includes('git')
            ) {
                return { parent: 'Work', name: 'Work > Dev', shortName: 'Dev', color: '#06b6d4' };
            }
            if (
                appL.includes('chrome') ||
                appL.includes('opera') ||
                appL.includes('firefox') ||
                appL.includes('edge') ||
                appL.includes('brave')
            ) {
                return { parent: 'Uncategorized', name: 'Web Browser', shortName: 'Navegador', color: '#38bdf8' };
            }

            return { parent: 'Uncategorized', name: 'Uncategorized', shortName: 'Outros', color: '#64748b' };
        }

        for (const ev of windowEvents) {
            const dur = ev.duration || 0;
            if (dur <= 0.5) continue;
            const app = ev.data?.app || 'Desconhecido';
            const title = ev.data?.title || app;

            totalActiveSeconds += dur;

            const cat = categorize(app, title);

            // Record project tracked time
            if (cat.projectId) {
                projectTrackedSeconds[cat.projectId] = (projectTrackedSeconds[cat.projectId] || 0) + dur;
            }

            const tKey = `${app}:::${title}`;
            if (!windowMap.has(tKey)) {
                windowMap.set(tKey, { title, app, seconds: 0, category: cat.name, color: cat.color });
            }
            windowMap.get(tKey).seconds += dur;

            if (!categoryMap.has(cat.name)) {
                categoryMap.set(cat.name, { name: cat.name, shortName: cat.shortName, parent: cat.parent, seconds: 0, color: cat.color });
            }
            categoryMap.get(cat.name).seconds += dur;

            if (!appMap.has(app)) {
                appMap.set(app, { app, seconds: 0, color: cat.color });
            }
            appMap.get(app).seconds += dur;
        }

        const topTitles = Array.from(windowMap.values())
            .sort((a, b) => b.seconds - a.seconds);

        const topCategories = Array.from(categoryMap.values())
            .sort((a, b) => b.seconds - a.seconds);

        const topApps = Array.from(appMap.values())
            .sort((a, b) => b.seconds - a.seconds);

        return {
            totalActiveSeconds,
            topTitles,
            topCategories,
            topApps,
            projectTrackedSeconds
        };
    }

    renderActivityWatchDashboard(container) {
        const topbar = container.createDiv('kt-aw-topbar');
        const activeFilter = this.awPeriodFilter || 'today';
        const selectedDate = this.awSelectedDate || new Date();

        const leftGroup = topbar.createDiv('kt-aw-topbar-left');
        const statusPill = leftGroup.createDiv('kt-aw-status-pill');
        statusPill.createSpan({ cls: 'kt-aw-status-dot' });
        statusPill.createSpan({ text: 'Online' });

        if (this.awData?.hostname) {
            const hostBadge = leftGroup.createDiv('kt-aw-badge');
            hostBadge.setText(`💻 ${this.awData.hostname}`);
        }

        let periodLabel = 'Hoje';
        if (activeFilter === 'today') {
            periodLabel = `Hoje (${selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`;
        } else if (activeFilter === 'yesterday') {
            periodLabel = `Ontem (${selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`;
        } else if (activeFilter === 'date') {
            periodLabel = selectedDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
        } else if (activeFilter === 'week') {
            periodLabel = 'Esta Semana';
        } else if (activeFilter === 'month') {
            periodLabel = selectedDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        }

        const dateBadge = leftGroup.createDiv('kt-aw-badge kt-aw-badge-date');
        dateBadge.setText(`📅 ${periodLabel}`);

        const totalSec = this.awData?.processed?.totalActiveSeconds || 0;
        const totalActiveBadge = leftGroup.createDiv('kt-aw-badge kt-aw-badge-highlight');
        totalActiveBadge.setText(`🔥 Ativo: ${this.formatSecondsDuration(totalSec)}`);

        const rightGroup = topbar.createDiv('kt-aw-topbar-right');
        
        // 1. Date Navigator (Dia Anterior, Date Input, Próximo Dia)
        const dateNav = rightGroup.createDiv('kt-aw-date-nav');
        
        const btnPrev = dateNav.createEl('button', {
            cls: 'kt-aw-date-nav-btn',
            text: '◀'
        });
        btnPrev.title = 'Dia Anterior';
        btnPrev.onclick = async () => {
            const cur = this.awSelectedDate ? new Date(this.awSelectedDate) : new Date();
            cur.setDate(cur.getDate() - 1);
            this.awSelectedDate = cur;
            this.awPeriodFilter = 'date';
            await this.loadActivityWatchData();
            this.render();
        };

        const dateInput = dateNav.createEl('input', {
            cls: 'kt-aw-date-picker-input',
            type: 'date'
        });
        dateInput.value = getHabitDateKey(selectedDate);
        dateInput.title = 'Escolher data no calendário';
        dateInput.onchange = async () => {
            if (dateInput.value) {
                const parts = dateInput.value.split('-').map(Number);
                this.awSelectedDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
                this.awPeriodFilter = 'date';
                await this.loadActivityWatchData();
                this.render();
            }
        };

        const btnNext = dateNav.createEl('button', {
            cls: 'kt-aw-date-nav-btn',
            text: '▶'
        });
        btnNext.title = 'Próximo Dia';
        btnNext.onclick = async () => {
            const cur = this.awSelectedDate ? new Date(this.awSelectedDate) : new Date();
            cur.setDate(cur.getDate() + 1);
            this.awSelectedDate = cur;
            this.awPeriodFilter = 'date';
            await this.loadActivityWatchData();
            this.render();
        };

        // 2. Period Preset Buttons
        const filterGroup = rightGroup.createDiv('kt-aw-filter-group');
        const filters = [
            { id: 'today', label: 'Hoje' },
            { id: 'yesterday', label: 'Ontem' },
            { id: 'week', label: 'Esta Semana' },
            { id: 'month', label: 'Este Mês' },
        ];

        filters.forEach(f => {
            const btn = filterGroup.createEl('button', {
                cls: `kt-aw-filter-btn ${activeFilter === f.id ? 'is-active' : ''}`,
                text: f.label
            });
            btn.onclick = async () => {
                this.awPeriodFilter = f.id;
                if (f.id === 'today') this.awSelectedDate = new Date();
                else if (f.id === 'yesterday') this.awSelectedDate = new Date(Date.now() - 86400000);
                await this.loadActivityWatchData();
                this.render();
            };
        });

        // Refresh & Disconnect actions
        const refreshBtn = rightGroup.createEl('button', {
            cls: 'kt-aw-action-btn',
            text: '🔄 Atualizar'
        });
        refreshBtn.title = 'Buscar dados mais recentes do ActivityWatch e atualizar hábitos';
        refreshBtn.onclick = async () => {
            refreshBtn.setText('⏳ Atualizando...');
            await this.loadActivityWatchData();
            await this.syncActivityWatchHabits();
            this.render();
            new obsidian.Notice('Dados do ActivityWatch e Hábitos atualizados!');
        };

        const disconnectBtn = rightGroup.createEl('button', {
            cls: 'kt-aw-action-btn kt-aw-btn-disconnect',
            text: 'Desconectar'
        });
        disconnectBtn.title = 'Desconectar integração com o ActivityWatch';
        disconnectBtn.onclick = async () => {
            this.plugin.settings.awConnected = false;
            this.awData = null;
            await this.plugin.saveSettings();
            this.render();
            new obsidian.Notice('ActivityWatch desconectado.');
        };

        // If no data loaded yet, load and render
        if (!this.awData) {
            const loading = container.createDiv('kt-aw-loading');
            loading.setText('⏳ Carregando dados do ActivityWatch...');
            this.loadActivityWatchData().then(() => this.render());
            return;
        }

        if (this.awData.error) {
            const errBox = container.createDiv('kt-aw-error-box');
            errBox.setText(`⚠️ Erro ao conectar ao ActivityWatch: ${this.awData.error}`);
            const retryBtn = errBox.createEl('button', { cls: 'kt-aw-btn-retry', text: 'Tentar Novamente' });
            retryBtn.onclick = async () => {
                await this.loadActivityWatchData();
                this.render();
            };
            return;
        }

        const processed = this.awData.processed || { totalActiveSeconds: 0, topTitles: [], topCategories: [], topApps: [] };

        // 3-Column Grid (Janelas, Categorias, Sunburst)
        const grid = container.createDiv('kt-aw-grid-3col');

        // Column 1: Top Window Titles
        this.renderActivityWatchTitles(grid, processed.topTitles);

        // Column 2: Top Categories
        this.renderActivityWatchCategories(grid, processed.topCategories, processed.totalActiveSeconds);

        // Column 3: Category Sunburst / Donut Ring
        this.renderActivityWatchSunburst(grid, processed.topCategories, processed.totalActiveSeconds);
    }

    renderActivityWatchTitles(container, topTitles) {
        const panel = container.createDiv('kt-aw-panel');
        
        const hdr = panel.createDiv('kt-aw-panel-header');
        hdr.createEl('h4', { text: '🪟 Top Window Titles' });
        hdr.createSpan({ cls: 'kt-aw-panel-count', text: `${topTitles.length} janelas` });

        const list = panel.createDiv('kt-aw-panel-list');

        if (topTitles.length === 0) {
            list.createDiv('kt-aw-empty-text').setText('Nenhuma janela registrada neste período.');
            return;
        }

        const maxSec = topTitles[0]?.seconds || 1;
        const limit = this.awExpandedWindows ? topTitles.length : 6;
        const visibleTitles = topTitles.slice(0, limit);

        visibleTitles.forEach(t => {
            const row = list.createDiv('kt-aw-item-row');
            
            const fillPct = Math.min(100, Math.max(3, (t.seconds / maxSec) * 100));
            const barBg = row.createDiv('kt-aw-item-bar-bg');
            barBg.style.width = `${fillPct}%`;
            barBg.style.background = t.color || '#ef4444';

            const content = row.createDiv('kt-aw-item-content');
            
            const left = content.createDiv('kt-aw-item-left');
            const appBadge = left.createSpan('kt-aw-app-tag');
            appBadge.setText(t.app.replace(/\.exe$/i, ''));

            const titleSpan = left.createSpan('kt-aw-item-title');
            titleSpan.setText(t.title);
            titleSpan.title = `${t.title} (${t.app})`;

            const right = content.createDiv('kt-aw-item-right');
            right.createSpan({ cls: 'kt-aw-item-dur', text: this.formatSecondsDuration(t.seconds) });
        });

        if (topTitles.length > 6) {
            const toggleBtn = panel.createEl('button', {
                cls: 'kt-aw-toggle-more-btn',
                text: this.awExpandedWindows ? '▲ Mostrar Menos' : `▼ Mostrar Mais (${topTitles.length - 6} restantes)`
            });
            toggleBtn.onclick = () => {
                this.awExpandedWindows = !this.awExpandedWindows;
                this.render();
            };
        }
    }

    renderActivityWatchCategories(container, topCategories, totalActiveSeconds) {
        const panel = container.createDiv('kt-aw-panel');
        
        const hdr = panel.createDiv('kt-aw-panel-header');
        hdr.createEl('h4', { text: '🏷️ Top Categories' });
        hdr.createSpan({ cls: 'kt-aw-panel-count', text: `${topCategories.length} categorias` });

        const list = panel.createDiv('kt-aw-panel-list');

        if (topCategories.length === 0) {
            list.createDiv('kt-aw-empty-text').setText('Nenhuma categoria registrada neste período.');
            return;
        }

        const maxSec = topCategories[0]?.seconds || 1;
        const limit = this.awExpandedCategories ? topCategories.length : 6;
        const visibleCats = topCategories.slice(0, limit);

        visibleCats.forEach(c => {
            const row = list.createDiv('kt-aw-item-row');
            
            const fillPct = Math.min(100, Math.max(3, (c.seconds / maxSec) * 100));
            const barBg = row.createDiv('kt-aw-item-bar-bg');
            barBg.style.width = `${fillPct}%`;
            barBg.style.background = c.color || '#3b82f6';

            const content = row.createDiv('kt-aw-item-content');
            
            const left = content.createDiv('kt-aw-item-left');
            const colorDot = left.createSpan('kt-aw-cat-dot');
            colorDot.style.background = c.color || '#3b82f6';

            const nameSpan = left.createSpan('kt-aw-item-title');
            nameSpan.setText(c.name);
            nameSpan.title = c.name;

            const right = content.createDiv('kt-aw-item-right');
            const pct = totalActiveSeconds > 0 ? Math.round((c.seconds / totalActiveSeconds) * 100) : 0;
            right.createSpan({ cls: 'kt-aw-item-pct', text: `${pct}%` });
            right.createSpan({ cls: 'kt-aw-item-dur', text: this.formatSecondsDuration(c.seconds) });
        });

        if (topCategories.length > 6) {
            const toggleBtn = panel.createEl('button', {
                cls: 'kt-aw-toggle-more-btn',
                text: this.awExpandedCategories ? '▲ Mostrar Menos' : `▼ Mostrar Mais (${topCategories.length - 6} restantes)`
            });
            toggleBtn.onclick = () => {
                this.awExpandedCategories = !this.awExpandedCategories;
                this.render();
            };
        }
    }

    renderActivityWatchSunburst(container, topCategories, totalActiveSeconds) {
        const panel = container.createDiv('kt-aw-panel kt-aw-sunburst-panel');
        
        const hdr = panel.createDiv('kt-aw-panel-header');
        hdr.createEl('h4', { text: '🍩 Category Sunburst / Donut' });

        const chartWrap = panel.createDiv('kt-aw-donut-wrap');
        this.renderSunburstSVG(chartWrap, topCategories, totalActiveSeconds);

        // Mini Legend below chart
        const legend = panel.createDiv('kt-aw-donut-legend');
        topCategories.slice(0, 5).forEach(c => {
            const item = legend.createDiv('kt-aw-legend-item');
            const dot = item.createSpan('kt-aw-legend-dot');
            dot.style.background = c.color || '#3b82f6';
            
            const pct = totalActiveSeconds > 0 ? Math.round((c.seconds / totalActiveSeconds) * 100) : 0;
            item.createSpan({ cls: 'kt-aw-legend-name', text: c.shortName || c.name });
            item.createSpan({ cls: 'kt-aw-legend-val', text: `${pct}%` });
        });
    }

    renderSunburstSVG(container, topCategories, totalActiveSeconds) {
        const size = 220;
        const cx = size / 2;
        const cy = size / 2;
        const outerR = 98;
        const innerR = 64;
        const centerHoleR = 56;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.setAttribute('class', 'kt-aw-sunburst-svg');

        if (totalActiveSeconds <= 0 || topCategories.length === 0) {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(cx));
            circle.setAttribute('cy', String(cy));
            circle.setAttribute('r', String(outerR));
            circle.setAttribute('fill', 'var(--background-modifier-border)');
            svg.appendChild(circle);
            container.appendChild(svg);
            return;
        }

        let currentAngle = -Math.PI / 2;

        topCategories.forEach(cat => {
            const slicePct = cat.seconds / totalActiveSeconds;
            const sliceAngle = slicePct * 2 * Math.PI;
            const startAngle = currentAngle;
            const endAngle = currentAngle + sliceAngle;
            currentAngle = endAngle;

            if (sliceAngle < 0.02) return;

            const x1_out = cx + outerR * Math.cos(startAngle);
            const y1_out = cy + outerR * Math.sin(startAngle);
            const x2_out = cx + outerR * Math.cos(endAngle);
            const y2_out = cy + outerR * Math.sin(endAngle);

            const x1_in = cx + innerR * Math.cos(startAngle);
            const y1_in = cy + innerR * Math.sin(startAngle);
            const x2_in = cx + innerR * Math.cos(endAngle);
            const y2_in = cy + innerR * Math.sin(endAngle);

            const largeArc = sliceAngle > Math.PI ? 1 : 0;

            const pathData = `
                M ${x1_out.toFixed(2)} ${y1_out.toFixed(2)}
                A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2_out.toFixed(2)} ${y2_out.toFixed(2)}
                L ${x2_in.toFixed(2)} ${y2_in.toFixed(2)}
                A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1_in.toFixed(2)} ${y1_in.toFixed(2)}
                Z
            `;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData);
            path.setAttribute('fill', cat.color || '#3b82f6');
            path.setAttribute('class', 'kt-aw-donut-slice');
            
            const pctFormatted = Math.round(slicePct * 100);
            const durFormatted = this.formatSecondsDuration(cat.seconds);
            
            const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleEl.textContent = `${cat.name}\n${durFormatted} (${pctFormatted}%)`;
            path.appendChild(titleEl);

            svg.appendChild(path);
        });

        // Center hole circle
        const centerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        centerCircle.setAttribute('cx', String(cx));
        centerCircle.setAttribute('cy', String(cy));
        centerCircle.setAttribute('r', String(centerHoleR));
        centerCircle.setAttribute('fill', 'var(--background-secondary)');
        centerCircle.setAttribute('class', 'kt-aw-donut-center');
        svg.appendChild(centerCircle);

        // Center total active time text
        const textVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textVal.setAttribute('x', String(cx));
        textVal.setAttribute('y', String(cy - 4));
        textVal.setAttribute('text-anchor', 'middle');
        textVal.setAttribute('dominant-baseline', 'central');
        textVal.setAttribute('class', 'kt-aw-donut-center-val');
        textVal.textContent = this.formatSecondsDuration(totalActiveSeconds);
        svg.appendChild(textVal);

        const textLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textLbl.setAttribute('x', String(cx));
        textLbl.setAttribute('y', String(cy + 15));
        textLbl.setAttribute('text-anchor', 'middle');
        textLbl.setAttribute('dominant-baseline', 'central');
        textLbl.setAttribute('class', 'kt-aw-donut-center-lbl');
        textLbl.textContent = 'Tempo Ativo';
        svg.appendChild(textLbl);

        container.appendChild(svg);
    }

    formatSecondsDuration(totalSec) {
        const sec = Math.round(totalSec || 0);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) {
            return `${h}h ${m}m`;
        }
        if (m > 0) {
            return `${m}m ${s}s`;
        }
        return `${s}s`;
    }

    // ----------------------------------------------------------
    // HABIT TRACKER VIEW (HÁBITOS & CONSISTÊNCIA DIÁRIA)
    // ----------------------------------------------------------

    renderHabitsView(container) {
        const wrap = container.createDiv('kt-habits-view');
        const ws = this.getWeekStart();
        const now = new Date();
        const todayStr = getHabitDateKey(now);

        const habits = this.plugin.settings.habits || [];
        const logs = this.plugin.settings.habitLogs || {};

        // 1. Habits Top Bar
        const topBar = wrap.createDiv('kt-habits-topbar');

        const headerInfo = topBar.createDiv('kt-habits-header-info');
        headerInfo.createEl('h2', { cls: 'kt-habits-main-title', text: '✨ Hábitos & Consistência Diária' });

        // Calculate Today's completion (considering only habits scheduled for today)
        const todayDayOfWeek = now.getDay();
        const scheduledTodayHabits = habits.filter(h => this.isHabitScheduledForDay(h, todayDayOfWeek));
        let todayDoneCount = 0;
        scheduledTodayHabits.forEach(h => {
            const v = logs[h.id]?.[todayStr];
            if (this.isHabitDone(h, v)) todayDoneCount++;
        });

        const todayTotal = scheduledTodayHabits.length;
        const pctToday = todayTotal > 0 ? Math.round((todayDoneCount / todayTotal) * 100) : 100;
        headerInfo.createEl('p', {
            cls: 'kt-habits-subtitle',
            text: `${habits.length} Hábitos configurados • Hoje: ${todayDoneCount}/${todayTotal} programados feitos (${pctToday}%)`
        });

        const topActions = topBar.createDiv('kt-habits-top-actions');

        if (this.plugin.settings.awConnected) {
            const syncAwBtn = topActions.createEl('button', {
                cls: 'kt-btn-sync-aw',
                text: '🔄 ActivityWatch'
            });
            syncAwBtn.title = 'Sincronizar dados do ActivityWatch para a semana atual';
            syncAwBtn.onclick = async () => {
                syncAwBtn.setText('⏳ Sincronizando...');
                syncAwBtn.disabled = true;
                await this.syncActivityWatchHabits();
                syncAwBtn.setText('🔄 ActivityWatch');
                syncAwBtn.disabled = false;
                this.render();
                new obsidian.Notice('✓ Hábitos sincronizados com ActivityWatch!');
            };
        }

        const newHabitBtn = topActions.createEl('button', {
            cls: 'kt-btn-new-habit mod-cta',
            text: '＋ Novo Hábito'
        });
        newHabitBtn.onclick = () => {
            new HabitModal(this.app, this.plugin, null, async (newH) => {
                if (!this.plugin.settings.habits) this.plugin.settings.habits = [];
                this.plugin.settings.habits.push(newH);
                await this.plugin.saveSettings();
                if (newH.type === 'time' && newH.awFilter) {
                    await this.syncActivityWatchHabits();
                }
                this.render();
                new obsidian.Notice(`Hábito "${newH.name}" criado!`);
            }).open();
        };

        // 2. Global KPIs
        const kpiRow = wrap.createDiv('kt-habits-kpi-row');

        // Best streak across habits
        let bestStreak = 0;
        habits.forEach(h => {
            const s = this.calculateHabitStreak(h, logs);
            if (s > bestStreak) bestStreak = s;
        });

        // Weekly consistency (only over scheduled days)
        let totalWeekChecks = 0;
        let doneWeekChecks = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(ws); d.setDate(d.getDate() + i);
            const dKey = getHabitDateKey(d);
            const dayOfWeek = d.getDay();
            habits.forEach(h => {
                if (this.isHabitScheduledForDay(h, dayOfWeek)) {
                    totalWeekChecks++;
                    if (this.isHabitDone(h, logs[h.id]?.[dKey])) doneWeekChecks++;
                }
            });
        }
        const weekConsistency = totalWeekChecks > 0 ? Math.round((doneWeekChecks / totalWeekChecks) * 100) : 0;

        // Total time in habits across all days
        let totalHabitMinutes = 0;
        habits.forEach(h => {
            if (h.type === 'time' && logs[h.id]) {
                Object.values(logs[h.id]).forEach(val => {
                    totalHabitMinutes += Number(val) || 0;
                });
            }
        });

        const kpi1 = kpiRow.createDiv('kt-habits-kpi-box');
        kpi1.createDiv('kt-kpi-val').setText(`${todayDoneCount} / ${todayTotal}`);
        kpi1.createDiv('kt-kpi-lbl').setText(`✅ Concluídos Hoje (${pctToday}%)`);

        const kpi2 = kpiRow.createDiv('kt-habits-kpi-box');
        kpi2.createDiv('kt-kpi-val').setText(`🔥 ${bestStreak} dias`);
        kpi2.createDiv('kt-kpi-lbl').setText('Maior Sequência Atual');

        const kpi3 = kpiRow.createDiv('kt-habits-kpi-box');
        kpi3.createDiv('kt-kpi-val').setText(`${weekConsistency}%`);
        kpi3.createDiv('kt-kpi-lbl').setText('📈 Consistência na Semana');

        const kpi4 = kpiRow.createDiv('kt-habits-kpi-box');
        kpi4.createDiv('kt-kpi-val').setText(formatMinutesToHours(totalHabitMinutes) || '0h');
        kpi4.createDiv('kt-kpi-lbl').setText('⏱ Tempo Total Dedicado');

        // 3. Weekly Habit Matrix Table
        if (habits.length === 0) {
            const empty = wrap.createDiv('kt-habits-empty');
            empty.setText('Nenhum hábito cadastrado.');
            empty.createEl('p', { text: 'Clique em "＋ Novo Hábito" para começar a rastrear seus hábitos diários!' });
            return;
        }

        const tableWrap = wrap.createDiv('kt-habits-table-wrap');
        const table = tableWrap.createEl('table', { cls: 'kt-habits-table' });

        // Header Row
        const thead = table.createEl('thead');
        const trHead = thead.createEl('tr');

        trHead.createEl('th', { cls: 'kt-th-habit', text: 'HÁBITO' });

        const weekDays = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(ws); d.setDate(d.getDate() + i);
            weekDays.push(d);
            const isToday = sameDay(d, now);
            const th = trHead.createEl('th', { cls: `kt-th-day ${isToday ? 'is-today' : ''}` });
            
            const daysShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
            th.createDiv('kt-th-dayname').setText(daysShort[d.getDay()]);
            th.createDiv('kt-th-daynum').setText(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`);
            if (isToday) th.title = 'Hoje';
        }

        trHead.createEl('th', { cls: 'kt-th-stat', text: 'SEMANA' });
        trHead.createEl('th', { cls: 'kt-th-stat', text: 'TOTAL / STREAK' });
        trHead.createEl('th', { cls: 'kt-th-act', text: '' });

        // Body Rows
        const tbody = table.createEl('tbody');
        habits.forEach(h => {
            const tr = tbody.createEl('tr', { cls: 'kt-habit-row' });
            tr.style.setProperty('--habit-color', h.color || '#6366f1');

            // Col 1: Habit Info
            const tdInfo = tr.createEl('td', { cls: 'kt-td-habit-info' });
            const dot = tdInfo.createSpan('kt-habit-color-dot');
            dot.style.backgroundColor = h.color || '#6366f1';

            const iconSpan = tdInfo.createSpan('kt-habit-icon');
            iconSpan.setText(h.icon || '✨');

            const nameBox = tdInfo.createDiv('kt-habit-name-box');
            nameBox.createSpan({ cls: 'kt-habit-name', text: h.name });

            // Frequency and target subtitle
            const activeCount = (h.activeDays && Array.isArray(h.activeDays)) ? h.activeDays.length : 7;
            let freqLabel = 'Diário';
            if (activeCount === 5 && !h.activeDays?.includes(0) && !h.activeDays?.includes(6)) {
                freqLabel = 'Seg a Sex';
            } else if (activeCount === 2 && h.activeDays?.includes(0) && h.activeDays?.includes(6)) {
                freqLabel = 'Fim de Semana';
            } else if (activeCount < 7) {
                freqLabel = `${activeCount}x por sem`;
            }

            let targetLabel = '';
            if (h.type === 'time') targetLabel = `Meta: ${formatMinutesToHours(h.target)} • ${freqLabel}`;
            else if (h.type === 'count') targetLabel = `Meta: ${h.target} ${h.unit || ''} • ${freqLabel}`;
            else targetLabel = freqLabel;
            nameBox.createSpan({ cls: 'kt-habit-meta-sub', text: targetLabel });

            // 7 Day Cells
            let weekDoneDays = 0;
            let weekScheduledDays = 0;

            weekDays.forEach(d => {
                const dKey = getHabitDateKey(d);
                const isToday = sameDay(d, now);
                const dayOfWeek = d.getDay();
                const isScheduled = this.isHabitScheduledForDay(h, dayOfWeek);
                if (isScheduled) weekScheduledDays++;

                const tdDay = tr.createEl('td', {
                    cls: `kt-td-day ${isToday ? 'is-today' : ''} ${!isScheduled ? 'is-off-day' : ''}`
                });
                const val = logs[h.id]?.[dKey];
                let isDone = this.isHabitDone(h, val);
                // For time habits with AW integration, count AW minutes towards done
                if (h.type === 'time' && !isDone && h.awFilter && this.plugin.settings.awConnected && this.awHabitCache) {
                    const cKey = `${h.id}::${dKey}`;
                    const awM = this.awHabitCache[cKey];
                    if (awM > 0) {
                        const combined = Math.max(Number(val) || 0, awM);
                        if (combined >= (h.target || 1)) isDone = true;
                    }
                }
                if (isDone) weekDoneDays++;

                if (h.type === 'boolean') {
                    const checkBtn = tdDay.createEl('button', {
                        cls: `kt-habit-check-btn ${isDone ? 'is-done' : ''} ${!isScheduled ? 'is-off-check' : ''}`,
                        text: isDone ? '✓' : (!isScheduled ? '·' : '○')
                    });
                    if (isDone) checkBtn.style.backgroundColor = h.color || '#6366f1';
                    checkBtn.title = isScheduled
                        ? (isDone ? 'Concluído!' : 'Marcar como feito')
                        : (isDone ? 'Concluído em dia extra de descanso!' : 'Dia de descanso / Não programado (clique para registrar extra)');

                    checkBtn.onclick = async () => {
                        await this.setHabitValue(h.id, dKey, !isDone);
                    };
                } else if (h.type === 'count') {
                    const countVal = Number(val) || 0;
                    const countBtn = tdDay.createEl('button', {
                        cls: `kt-habit-count-btn ${isDone ? 'is-done' : (countVal > 0 ? 'is-partial' : '')} ${!isScheduled ? 'is-off-check' : ''}`,
                        text: countVal > 0 ? `${countVal}` : (!isScheduled ? '·' : '—')
                    });
                    if (isDone) {
                        countBtn.style.backgroundColor = h.color || '#6366f1';
                    }
                    countBtn.title = isScheduled
                        ? `${countVal}/${h.target} ${h.unit || ''} (Clique para registrar)`
                        : `${countVal}/${h.target} ${h.unit || ''} • Dia de descanso (Clique para registrar extra)`;
                    countBtn.onclick = () => {
                        new HabitQuickValueModal(this.app, h, d, countVal, async (newV) => {
                            await this.setHabitValue(h.id, dKey, newV);
                        }).open();
                    };
                } else if (h.type === 'time') {
                    const timeMin = Number(val) || 0;
                    const cacheKey = `${h.id}::${dKey}`;
                    const awMins = (h.awFilter && this.plugin.settings.awConnected && this.awHabitCache)
                        ? (this.awHabitCache[cacheKey] ?? null)
                        : null;
                    const totalMin = Math.max(timeMin, (awMins || 0));
                    const isDoneTotal = totalMin >= (h.target || 1);
                    const isPartial = totalMin > 0 && !isDoneTotal;

                    const timeBtn = tdDay.createEl('button', {
                        cls: `kt-habit-time-btn ${isDoneTotal ? 'is-done' : (isPartial ? 'is-partial' : '')} ${!isScheduled ? 'is-off-check' : ''}`
                    });
                    if (isDoneTotal) {
                        timeBtn.style.backgroundColor = h.color || '#6366f1';
                    }

                    if (totalMin > 0) {
                        timeBtn.createSpan({ text: formatMinutesToHours(totalMin) || `${totalMin}m` });
                        if (awMins !== null && awMins > 0) {
                            const awBadge = timeBtn.createSpan({ cls: 'kt-habit-aw-badge', text: '⌚' });
                            awBadge.title = `ActivityWatch: ${formatMinutesToHours(awMins)} detectados automaticamente`;
                        }
                    } else if (awMins === null && h.awFilter && this.plugin.settings.awConnected && this._isSyncingAwHabits) {
                        timeBtn.setText('⏳');
                        timeBtn.title = 'Buscando dados do ActivityWatch...';
                    } else {
                        timeBtn.setText(!isScheduled ? '·' : '—');
                    }

                    let titleParts = [`Meta: ${formatMinutesToHours(h.target)}`];
                    if (totalMin > 0) titleParts.push(`Total: ${formatMinutesToHours(totalMin)}`);
                    if (awMins !== null && awMins > 0) titleParts.push(`ActivityWatch: ${formatMinutesToHours(awMins)}`);
                    if (!isScheduled) titleParts.push('Dia de descanso (clique para registrar extra)');
                    timeBtn.title = titleParts.join(' • ');

                    timeBtn.onclick = () => {
                        new HabitQuickValueModal(this.app, h, d, totalMin, async (newV) => {
                            await this.setHabitValue(h.id, dKey, newV);
                        }).open();
                    };
                }
            });

            // Col 9: Weekly Progress (based on scheduled days in the week)
            const tdWeek = tr.createEl('td', { cls: 'kt-td-stat' });
            const targetWeekDays = weekScheduledDays > 0 ? weekScheduledDays : 1;
            const pct = Math.min(100, Math.round((weekDoneDays / targetWeekDays) * 100));
            const progWrap = tdWeek.createDiv('kt-habit-prog-wrap');
            const progBar = progWrap.createDiv('kt-habit-prog-bar');
            progBar.style.width = `${pct}%`;
            progBar.style.backgroundColor = h.color || '#6366f1';
            tdWeek.createSpan({ cls: 'kt-habit-prog-lbl', text: `${weekDoneDays}/${targetWeekDays} (${pct}%)` });

            // Col 10: Total & Streak
            const tdTotal = tr.createEl('td', { cls: 'kt-td-stat' });
            const streak = this.calculateHabitStreak(h, logs);
            const totalSummary = this.calculateHabitTotal(h, logs);
            
            const streakBadge = tdTotal.createSpan('kt-habit-streak-badge');
            streakBadge.setText(`🔥 ${streak}d`);
            tdTotal.createSpan({ cls: 'kt-habit-total-lbl', text: totalSummary });

            // Col 11: Edit Button
            const tdAct = tr.createEl('td', { cls: 'kt-td-act' });
            const editBtn = tdAct.createEl('button', { cls: 'kt-habit-edit-btn', text: '✎' });
            editBtn.title = 'Editar Hábito';
            editBtn.onclick = () => {
                new HabitModal(
                    this.app,
                    this.plugin,
                    h,
                    async (updatedH) => {
                        const idx = this.plugin.settings.habits.findIndex(item => item.id === h.id);
                        if (idx !== -1) {
                            this.plugin.settings.habits[idx] = updatedH;
                            await this.plugin.saveSettings();
                            if (updatedH.type === 'time' && updatedH.awFilter) {
                                await this.syncActivityWatchHabits();
                            }
                            this.render();
                            new obsidian.Notice(`Hábito "${updatedH.name}" atualizado!`);
                        }
                    },
                    async () => {
                        this.plugin.settings.habits = this.plugin.settings.habits.filter(item => item.id !== h.id);
                        if (this.plugin.settings.habitLogs) delete this.plugin.settings.habitLogs[h.id];
                        await this.plugin.saveSettings();
                        this.render();
                        new obsidian.Notice(`Hábito "${h.name}" removido.`);
                    }
                ).open();
            };
        });
    }

    isHabitScheduledForDay(habit, dayIndex) {
        if (!habit || !habit.activeDays || !Array.isArray(habit.activeDays) || habit.activeDays.length === 0) {
            return true;
        }
        return habit.activeDays.includes(dayIndex);
    }

    isHabitDone(habit, val) {
        if (val === undefined || val === null || val === false) return false;
        if (habit.type === 'boolean') return Boolean(val);
        if (habit.type === 'count') return (Number(val) || 0) >= (habit.target || 1);
        if (habit.type === 'time') return (Number(val) || 0) >= (habit.target || 1);
        return false;
    }

    async setHabitValue(habitId, dateKey, value) {
        if (!this.plugin.settings.habitLogs) this.plugin.settings.habitLogs = {};
        if (!this.plugin.settings.habitLogs[habitId]) this.plugin.settings.habitLogs[habitId] = {};
        
        if (value === false || value === 0 || value === null) {
            delete this.plugin.settings.habitLogs[habitId][dateKey];
        } else {
            this.plugin.settings.habitLogs[habitId][dateKey] = value;
        }

        await this.plugin.saveSettings();
        this.render();
    }

    calculateHabitStreak(habit, logs) {
        const habitLog = logs[habit.id] || {};
        const now = new Date();
        let streak = 0;

        let checkDate = new Date(now);
        const todayKey = getHabitDateKey(checkDate);
        const todayDayOfWeek = checkDate.getDay();
        const isScheduledToday = this.isHabitScheduledForDay(habit, todayDayOfWeek);

        // If today is completed, count today and check backwards
        if (this.isHabitDone(habit, habitLog[todayKey])) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else if (!isScheduledToday) {
            // Today is rest day -> check backwards without resetting
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            // Today is scheduled but not checked yet -> check backwards
            checkDate.setDate(checkDate.getDate() - 1);
        }

        for (let i = 0; i < 365; i++) {
            const k = getHabitDateKey(checkDate);
            const dow = checkDate.getDay();
            const isScheduled = this.isHabitScheduledForDay(habit, dow);

            if (this.isHabitDone(habit, habitLog[k])) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else if (!isScheduled) {
                // Rest day does not break streak
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                // Missed a scheduled day -> break streak
                break;
            }
        }

        return streak;
    }

    calculateHabitTotal(habit, logs) {
        const habitLog = logs[habit.id] || {};
        const entries = Object.values(habitLog);

        if (habit.type === 'boolean') {
            const count = entries.filter(v => Boolean(v)).length;
            return `${count} dias`;
        } else if (habit.type === 'count') {
            let sum = 0;
            entries.forEach(v => sum += (Number(v) || 0));
            return `${sum} ${habit.unit || 'vezes'}`;
        } else if (habit.type === 'time') {
            let sumMin = 0;
            entries.forEach(v => sumMin += (Number(v) || 0));
            return formatMinutesToHours(sumMin) || '0m';
        }
        return '—';
    }

    /**
     * Helper to match a habit's ActivityWatch filter against a categorized event or raw app/title.
     */
    isAwCategoryMatch(filterStr, cat, app, title) {
        if (!filterStr || !filterStr.trim()) return false;
        const f = filterStr.trim().toLowerCase();

        // Check against categorized metadata
        if (cat) {
            const catFullName = (cat.name || '').toLowerCase();
            const catShortName = (cat.shortName || '').toLowerCase();
            const catParent = (cat.parent || '').toLowerCase();

            if (catFullName === f || catShortName === f || catParent === f) return true;
            if (catFullName.includes(f) || f.includes(catFullName)) return true;
            if (catShortName.includes(f) || f.includes(catShortName)) return true;
            if (cat.projectId && (cat.projectId.toLowerCase() === f || (cat.shortName && cat.shortName.toLowerCase() === f))) return true;
        }

        // Direct app / window title match
        const appL = (app || '').toLowerCase();
        const titleL = (title || '').toLowerCase();
        if (appL.includes(f) || titleL.includes(f)) return true;

        // Comma-separated list support
        if (filterStr.includes(',')) {
            const parts = filterStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            for (const p of parts) {
                if (this.isAwCategoryMatch(p, cat, app, title)) return true;
            }
        }

        return false;
    }

    /**
     * Synchronize ActivityWatch tracked time into all linked time habits for the current period.
     * Updates both awHabitCache and plugin.settings.habitLogs for permanent persistence.
     */
    async syncActivityWatchHabits(startDate, endDate) {
        if (!this.plugin.settings.awConnected) return;
        const habits = (this.plugin.settings.habits || []).filter(h => h.type === 'time' && h.awFilter && h.awFilter.trim());
        if (habits.length === 0) return;

        const host = this.plugin.settings.awHost || 'http://127.0.0.1:5600';
        try {
            // 1. Fetch info and classes from ActivityWatch
            const [infoRes, settingsRes] = await Promise.all([
                obsidian.requestUrl({ url: `${host}/api/0/info` }),
                obsidian.requestUrl({ url: `${host}/api/0/settings` }).catch(() => ({ json: null }))
            ]);
            const hostname = infoRes.json?.hostname || 'localhost';
            const awClasses = settingsRes.json?.classes || [];

            // 2. Determine date range (covers the entire active week: Monday 00:00:00 to Sunday 23:59:59)
            const ws = this.getWeekStart ? this.getWeekStart() : startOfDay(new Date());
            const we = new Date(ws);
            we.setDate(we.getDate() + 7);
            const rangeStart = startDate || ws;
            const rangeEnd = endDate || we;

            const startIso = rangeStart.toISOString();
            const endIso = rangeEnd.toISOString();
            const winBucket = `aw-watcher-window_${hostname}`;
            const eventsUrl = `${host}/api/0/buckets/${winBucket}/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=-1`;

            const eventsRes = await obsidian.requestUrl({ url: eventsUrl });
            const windowEvents = eventsRes.json || [];

            // 3. Compile regex rules from AW classes & plugin projects
            const compiledAWClasses = (awClasses || [])
                .filter(c => c.rule && c.rule.type === 'regex' && c.rule.regex && c.rule.regex !== 'FILL ME')
                .map(c => {
                    let reg = null;
                    try { reg = new RegExp(c.rule.regex, c.rule.ignore_case !== false ? 'i' : ''); } catch (e) {}
                    return {
                        id: c.id,
                        fullName: (c.name || []).join(' > '),
                        shortName: (c.name || [])[(c.name || []).length - 1] || 'Uncategorized',
                        parent: (c.name || [])[0] || 'Uncategorized',
                        regex: reg
                    };
                })
                .filter(c => c.regex !== null);

            const projectRules = (this.plugin.settings.projects || []).map(p => ({
                id: p.id,
                name: p.name,
                tag: (p.tag || '').replace(/^#/, '').toLowerCase(),
                nameLower: p.name.toLowerCase(),
                customPatterns: (p.awPattern || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
            }));

            const categorize = (app, title) => {
                const appL = (app || '').toLowerCase();
                const titleL = (title || '').toLowerCase();
                const fullTarget = `${app} ${title}`;

                let matchedAW = null;
                for (const cls of compiledAWClasses) {
                    if (cls.regex.test(fullTarget) || cls.regex.test(title) || cls.regex.test(app)) {
                        matchedAW = cls;
                        break;
                    }
                }

                for (const pr of projectRules) {
                    let isProjectMatch = false;
                    if (matchedAW) {
                        const awLastName = matchedAW.shortName.toLowerCase();
                        const awFullName = matchedAW.fullName.toLowerCase();
                        if (awLastName === pr.nameLower || awFullName.includes(pr.nameLower) || (pr.tag && awFullName.includes(pr.tag))) {
                            isProjectMatch = true;
                        }
                    }
                    if (!isProjectMatch) {
                        for (const pat of pr.customPatterns) {
                            try {
                                if (new RegExp(pat, 'i').test(titleL) || new RegExp(pat, 'i').test(appL)) { isProjectMatch = true; break; }
                            } catch {
                                if (titleL.includes(pat) || appL.includes(pat)) { isProjectMatch = true; break; }
                            }
                        }
                        if (!isProjectMatch && ((pr.tag && titleL.includes(pr.tag)) || (pr.nameLower && titleL.includes(pr.nameLower)) || (pr.tag && appL.includes(pr.tag)))) {
                            isProjectMatch = true;
                        }
                    }
                    if (isProjectMatch) {
                        return {
                            projectId: pr.id,
                            parent: matchedAW ? matchedAW.parent : 'Work',
                            name: matchedAW ? matchedAW.fullName : `Work > ${pr.name}`,
                            shortName: pr.name
                        };
                    }
                }

                if (matchedAW) {
                    return {
                        projectId: null,
                        parent: matchedAW.parent,
                        name: matchedAW.fullName,
                        shortName: matchedAW.shortName
                    };
                }

                if (appL.includes('obsidian')) return { parent: 'Obsidian', name: 'Obsidian', shortName: 'Obsidian' };
                if (appL.includes('whatsapp') || appL.includes('telegram') || appL.includes('discord') || titleL.includes('youtube') || titleL.includes('reddit') || titleL.includes('twitter') || titleL.includes('instagram') || titleL.includes('twitch')) {
                    return { parent: 'Media', name: 'Media > Social Media', shortName: 'Social Media' };
                }
                if (appL.includes('spotify') || appL.includes('vlc') || appL.includes('netflix')) return { parent: 'Media', name: 'Media > Video & Audio', shortName: 'Video & Audio' };
                if (appL.includes('unity') || appL.includes('rider') || appL.includes('code') || appL.includes('visual studio') || appL.includes('blender') || appL.includes('godot') || appL.includes('unreal') || appL.includes('git')) {
                    return { parent: 'Work', name: 'Work > Dev', shortName: 'Dev' };
                }
                if (appL.includes('chrome') || appL.includes('opera') || appL.includes('firefox') || appL.includes('edge') || appL.includes('brave')) {
                    return { parent: 'Uncategorized', name: 'Web Browser', shortName: 'Navegador' };
                }
                return { parent: 'Uncategorized', name: 'Uncategorized', shortName: 'Outros' };
            };

            // 4. Pre-populate all 7 days of the active week with 0
            const habitDaySeconds = {};
            const weekDateKeys = [];
            for (let i = 0; i < 7; i++) {
                const dayDate = new Date(ws);
                dayDate.setDate(dayDate.getDate() + i);
                weekDateKeys.push(getHabitDateKey(dayDate));
            }

            habits.forEach(h => {
                habitDaySeconds[h.id] = {};
                weekDateKeys.forEach(k => {
                    habitDaySeconds[h.id][k] = 0;
                });
            });

            // Group event durations by day
            for (const ev of windowEvents) {
                const dur = ev.duration || 0;
                if (dur <= 0.5) continue;
                const evDate = new Date(ev.timestamp);
                const dKey = getHabitDateKey(evDate);
                const app = ev.data?.app || 'Desconhecido';
                const title = ev.data?.title || app;

                const cat = categorize(app, title);

                for (const h of habits) {
                    if (this.isAwCategoryMatch(h.awFilter, cat, app, title)) {
                        habitDaySeconds[h.id][dKey] = (habitDaySeconds[h.id][dKey] || 0) + dur;
                    }
                }
            }

            // 5. Update cache and save into habitLogs
            if (!this.plugin.settings.habitLogs) this.plugin.settings.habitLogs = {};
            if (!this.awHabitCache) this.awHabitCache = {};

            let hasChanges = false;
            for (const h of habits) {
                if (!this.plugin.settings.habitLogs[h.id]) this.plugin.settings.habitLogs[h.id] = {};
                const dayMap = habitDaySeconds[h.id] || {};
                for (const [dKey, secs] of Object.entries(dayMap)) {
                    const mins = Math.round(secs / 60);
                    this.awHabitCache[`${h.id}::${dKey}`] = mins;
                    if (mins > 0) {
                        const currentVal = Number(this.plugin.settings.habitLogs[h.id][dKey]) || 0;
                        if (currentVal !== mins) {
                            this.plugin.settings.habitLogs[h.id][dKey] = mins;
                            hasChanges = true;
                        }
                    }
                }
            }

            if (hasChanges) {
                await this.plugin.saveSettings();
            }
        } catch (e) {
            console.error('[Kanban Timeline] Erro ao sincronizar ActivityWatch com Hábitos:', e);
        }
    }

    // ----------------------------------------------------------
    // POST-IT MURAL / STICKY NOTES VIEW
    // ----------------------------------------------------------

    renderPostItsView(container) {
        const wrap = container.createDiv('kt-postits-view');

        const postIts = this.plugin.settings.postIts || [];
        const POSTIT_COLORS = [
            { id: 'yellow', name: 'Amarelo', bg: '#fef08a', text: '#422006' },
            { id: 'pink',   name: 'Rosa',    bg: '#fbcfe8', text: '#500724' },
            { id: 'green',  name: 'Verde',   bg: '#bbf7d0', text: '#052e16' },
            { id: 'blue',   name: 'Azul',    bg: '#bae6fd', text: '#082f49' },
            { id: 'orange', name: 'Laranja', bg: '#fed7aa', text: '#431407' },
            { id: 'purple', name: 'Roxo',    bg: '#e9d5ff', text: '#3b0764' },
        ];

        // 1. Top Header Bar
        const topBar = wrap.createDiv('kt-postit-topbar');

        const leftInfo = topBar.createDiv('kt-postit-top-left');
        leftInfo.createEl('h2', { cls: 'kt-postit-title', text: '📌 Quadro de Post-its & Ideias' });
        leftInfo.createEl('p', {
            cls: 'kt-postit-subtitle',
            text: `${postIts.length} Post-its no quadro • Arraste novos post-its da bandeja inferior para o quadro`
        });

        const rightActions = topBar.createDiv('kt-postit-top-actions');

        // Organize in Grid button
        if (postIts.length > 0) {
            const organizeBtn = rightActions.createEl('button', {
                cls: 'kt-postit-action-btn',
                text: '📐 Organizar em Grade'
            });
            organizeBtn.onclick = async () => {
                const margin = 30;
                const noteW = 200;
                const noteH = 200;
                const gap = 24;
                const canvasW = canvas.clientWidth || 900;
                const cols = Math.max(1, Math.floor((canvasW - margin * 2) / (noteW + gap)));

                postIts.forEach((pi, idx) => {
                    const row = Math.floor(idx / cols);
                    const col = idx % cols;
                    pi.x = margin + col * (noteW + gap);
                    pi.y = margin + row * (noteH + gap);
                    pi.rotation = Number((Math.random() * 3 - 1.5).toFixed(1));
                });

                await this.plugin.saveSettings();
                this.render();
                new obsidian.Notice('Post-its organizados em grade!');
            };

            // Clear all button
            const clearBtn = rightActions.createEl('button', {
                cls: 'kt-postit-action-btn mod-warning',
                text: '🗑️ Limpar Quadro'
            });
            clearBtn.onclick = async () => {
                new ConfirmDeleteModal(this.app, 'todos os Post-its deste quadro', async () => {
                    this.plugin.settings.postIts = [];
                    await this.plugin.saveSettings();
                    this.render();
                    new obsidian.Notice('Quadro limpo.');
                }).open();
            };
        }

        // 2. Canvas Board Area (Quadro Interativo)
        const canvas = wrap.createDiv('kt-postit-canvas');

        // Drop listener on Canvas
        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            canvas.addClass('is-drag-over');
        });

        canvas.addEventListener('dragleave', (e) => {
            if (e.relatedTarget === null || !canvas.contains(e.relatedTarget)) {
                canvas.removeClass('is-drag-over');
            }
        });

        canvas.addEventListener('drop', async (e) => {
            e.preventDefault();
            canvas.removeClass('is-drag-over');
            const color = e.dataTransfer.getData('postit-color') || 'yellow';
            const rect = canvas.getBoundingClientRect();
            const dropX = Math.max(15, Math.round(e.clientX - rect.left + canvas.scrollLeft - 90));
            const dropY = Math.max(15, Math.round(e.clientY - rect.top + canvas.scrollTop - 30));

            const newNote = {
                id: 'pi-' + Date.now(),
                text: '',
                color,
                x: dropX,
                y: dropY,
                rotation: Number((Math.random() * 4 - 2).toFixed(1)),
                zIndex: (this.maxPostItZIndex || 10) + 1
            };

            this.maxPostItZIndex = newNote.zIndex;
            if (!this.plugin.settings.postIts) this.plugin.settings.postIts = [];
            this.plugin.settings.postIts.push(newNote);
            await this.plugin.saveSettings();
            this.newlyCreatedPostItId = newNote.id;
            this.render();
        });

        // Double click on canvas creates a post-it
        canvas.addEventListener('dblclick', async (e) => {
            if (e.target !== canvas) return;
            const rect = canvas.getBoundingClientRect();
            const dropX = Math.max(15, Math.round(e.clientX - rect.left + canvas.scrollLeft - 90));
            const dropY = Math.max(15, Math.round(e.clientY - rect.top + canvas.scrollTop - 30));

            const newNote = {
                id: 'pi-' + Date.now(),
                text: '',
                color: 'yellow',
                x: dropX,
                y: dropY,
                rotation: Number((Math.random() * 4 - 2).toFixed(1)),
                zIndex: (this.maxPostItZIndex || 10) + 1
            };

            this.maxPostItZIndex = newNote.zIndex;
            if (!this.plugin.settings.postIts) this.plugin.settings.postIts = [];
            this.plugin.settings.postIts.push(newNote);
            await this.plugin.saveSettings();
            this.newlyCreatedPostItId = newNote.id;
            this.render();
        });

        // Empty Board Hint
        if (postIts.length === 0) {
            const emptyHint = canvas.createDiv('kt-postit-empty-hint');
            emptyHint.createEl('div', { cls: 'kt-postit-empty-icon', text: '📝' });
            emptyHint.createEl('h3', { text: 'Seu quadro de post-its está vazio' });
            emptyHint.createEl('p', { text: 'Arraste um post-it da bandeja abaixo ou dê um duplo clique no quadro para começar!' });
        }

        // Render all existing Post-its on the canvas
        postIts.forEach(pi => {
            this.renderSinglePostIt(canvas, pi);
        });

        // 3. Bottom Tray / Dock with Colored Stacks
        const dock = wrap.createDiv('kt-postit-dock');

        const dockLabel = dock.createDiv('kt-dock-label');
        dockLabel.createSpan({ text: '📋 Arraste para o quadro:' });

        const stacksRow = dock.createDiv('kt-dock-stacks');

        POSTIT_COLORS.forEach(c => {
            const stack = stacksRow.createDiv(`kt-postit-stack stack-${c.id}`);
            stack.style.setProperty('--stack-color', c.bg);
            stack.style.setProperty('--stack-text', c.text);
            stack.title = `Arrastar Post-it ${c.name} para o quadro (ou clique para adicionar)`;
            stack.setAttribute('draggable', 'true');

            // Stack layer graphics (giving realistic 3D paper stack feel)
            stack.createDiv('kt-stack-layer-3');
            stack.createDiv('kt-stack-layer-2');
            const topLayer = stack.createDiv('kt-stack-top');
            topLayer.createSpan({ cls: 'kt-stack-name', text: c.name });
            topLayer.createSpan({ cls: 'kt-stack-plus', text: '＋' });

            // Drag Start
            stack.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('postit-color', c.id);
                e.dataTransfer.effectAllowed = 'copy';
                stack.addClass('is-dragging');
            });

            stack.addEventListener('dragend', () => {
                stack.removeClass('is-dragging');
            });

            // Click spawn
            stack.onclick = async () => {
                const count = (this.plugin.settings.postIts || []).length;
                const offset = (count % 7) * 32;
                const newNote = {
                    id: 'pi-' + Date.now(),
                    text: '',
                    color: c.id,
                    x: 60 + offset,
                    y: 60 + offset,
                    rotation: Number((Math.random() * 4 - 2).toFixed(1)),
                    zIndex: (this.maxPostItZIndex || 10) + 1
                };

                this.maxPostItZIndex = newNote.zIndex;
                if (!this.plugin.settings.postIts) this.plugin.settings.postIts = [];
                this.plugin.settings.postIts.push(newNote);
                await this.plugin.saveSettings();
                this.newlyCreatedPostItId = newNote.id;
                this.render();
            };
        });
    }

    renderSinglePostIt(canvas, pi) {
        const note = canvas.createDiv(`kt-postit-note note-${pi.color || 'yellow'}`);
        note.style.left = `${pi.x || 50}px`;
        note.style.top = `${pi.y || 50}px`;
        if (pi.width) note.style.width = `${pi.width}px`;
        if (pi.height) note.style.height = `${pi.height}px`;
        note.style.transform = `rotate(${pi.rotation || 0}deg)`;
        note.style.zIndex = String(pi.zIndex || 1);

        // Header / Tape bar for dragging
        const header = note.createDiv('kt-postit-header');
        
        // Pin visual
        const pin = header.createSpan('kt-postit-pin');
        pin.setText(pi.isPinned ? '📌' : '📍');
        pin.title = pi.isPinned ? 'Fixado (clique para desfixar)' : 'Fixar post-it no quadro';
        pin.onclick = async (e) => {
            e.stopPropagation();
            pi.isPinned = !pi.isPinned;
            await this.plugin.saveSettings();
            this.render();
        };

        // Actions (Delete button)
        const noteActions = header.createDiv('kt-postit-actions');

        const delBtn = noteActions.createSpan('kt-postit-del-btn');
        delBtn.setText('✕');
        delBtn.title = 'Excluir post-it';
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            this.plugin.settings.postIts = (this.plugin.settings.postIts || []).filter(item => item.id !== pi.id);
            await this.plugin.saveSettings();
            this.render();
        };

        // Textarea for post-it content
        const textarea = note.createEl('textarea', {
            cls: 'kt-postit-textarea',
            placeholder: 'Escreva algo aqui...'
        });
        textarea.value = pi.text || '';
        if (pi.fontSize) {
            textarea.style.fontSize = `${pi.fontSize}px`;
        }

        // Auto focus if just created
        if (this.newlyCreatedPostItId === pi.id) {
            this.newlyCreatedPostItId = null;
            setTimeout(() => {
                textarea.focus();
            }, 30);
        }

        // Save on input / blur
        let saveTimeout;
        textarea.addEventListener('input', () => {
            pi.text = textarea.value;
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                await this.plugin.saveSettings();
            }, 500);
        });

        textarea.addEventListener('blur', async () => {
            pi.text = textarea.value;
            await this.plugin.saveSettings();
        });

        // Ctrl + Scroll Wheel to Zoom Font Size
        note.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();

                const curSize = pi.fontSize || 15;
                const step = e.deltaY < 0 ? 1 : -1;
                const newSize = Math.max(10, Math.min(52, curSize + step));
                pi.fontSize = newSize;
                textarea.style.fontSize = `${newSize}px`;

                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(async () => {
                    await this.plugin.saveSettings();
                }, 400);
            }
        }, { passive: false });

        // Color palette switcher in bottom bar of post-it
        const footer = note.createDiv('kt-postit-footer');
        const colorPalette = footer.createDiv('kt-postit-palette');
        ['yellow', 'pink', 'green', 'blue', 'orange', 'purple'].forEach(col => {
            const dot = colorPalette.createSpan(`kt-postit-color-dot dot-${col} ${pi.color === col ? 'is-active' : ''}`);
            dot.onclick = async (e) => {
                e.stopPropagation();
                pi.color = col;
                await this.plugin.saveSettings();
                this.render();
            };
        });

        // Bottom-Right Corner Resize Handle
        const resizeHandle = note.createDiv('kt-postit-resize-handle');
        resizeHandle.title = 'Arrastar para redimensionar o post-it';

        let isResizing = false;
        let rStartX, rStartY;
        let initialW, initialH;

        resizeHandle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            isResizing = true;
            rStartX = e.clientX;
            rStartY = e.clientY;
            initialW = note.offsetWidth;
            initialH = note.offsetHeight;

            // Bring to top while resizing
            this.maxPostItZIndex = (this.maxPostItZIndex || 10) + 1;
            pi.zIndex = this.maxPostItZIndex;
            note.style.zIndex = String(pi.zIndex);

            note.addClass('is-resizing');
            document.body.addClass('kt-is-postit-resizing');

            const rad = ((pi.rotation || 0) * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            const onPointerMove = (moveEvt) => {
                if (!isResizing) return;
                const rawDx = moveEvt.clientX - rStartX;
                const rawDy = moveEvt.clientY - rStartY;

                // Project mouse movement onto rotated post-it coordinate system
                const unrotatedDx = rawDx * cos + rawDy * sin;
                const unrotatedDy = -rawDx * sin + rawDy * cos;

                const newW = Math.max(140, Math.min(900, Math.round(initialW + unrotatedDx)));
                const newH = Math.max(130, Math.min(900, Math.round(initialH + unrotatedDy)));

                note.style.width = `${newW}px`;
                note.style.height = `${newH}px`;
                pi.width = newW;
                pi.height = newH;
            };

            const onPointerUp = async () => {
                if (!isResizing) return;
                isResizing = false;
                note.removeClass('is-resizing');
                document.body.removeClass('kt-is-postit-resizing');
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                await this.plugin.saveSettings();
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });

        // Dragging the post-it on the canvas
        let isDragging = false;
        let startX, startY;
        let initialX, initialY;

        header.addEventListener('pointerdown', (e) => {
            if (e.target === pin || e.target === delBtn) return;
            if (pi.isPinned) return; // Pinned notes cannot be moved

            e.preventDefault();
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = pi.x || 50;
            initialY = pi.y || 50;

            // Bring to top
            this.maxPostItZIndex = (this.maxPostItZIndex || 10) + 1;
            pi.zIndex = this.maxPostItZIndex;
            note.style.zIndex = String(pi.zIndex);

            note.addClass('is-moving');
            document.body.addClass('kt-is-postit-dragging');

            const onPointerMove = (moveEvt) => {
                if (!isDragging) return;
                const dx = moveEvt.clientX - startX;
                const dy = moveEvt.clientY - startY;
                const curX = Math.max(10, initialX + dx);
                const curY = Math.max(10, initialY + dy);
                pi.x = curX;
                pi.y = curY;
                note.style.left = `${curX}px`;
                note.style.top = `${curY}px`;
            };

            const onPointerUp = async () => {
                if (!isDragging) return;
                isDragging = false;
                note.removeClass('is-moving');
                document.body.removeClass('kt-is-postit-dragging');
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                await this.plugin.saveSettings();
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });
    }

    // ----------------------------------------------------------
    // FINANCES (CONTROLE FINANCEIRO & ORÇAMENTO MENSAL)
    // ----------------------------------------------------------

    getFinancesMonthData(year, month) {
        const fin = this.plugin.settings.finances;
        const key = `${year}-${String(month).padStart(2, '0')}`;
        if (!fin.months[key]) {
            fin.months[key] = {
                initialBalance: null,
                plannedExpenses: {},
                plannedIncome: {},
                expenses: [],
                income: []
            };
        }
        return fin.months[key];
    }

    getInheritedInitialBalance(year, month) {
        const fin = this.plugin.settings.finances;
        const key = `${year}-${String(month).padStart(2, '0')}`;
        const currentData = fin.months[key];
        if (currentData && currentData.initialBalance != null) {
            return currentData.initialBalance;
        }

        // Calculate from previous month
        let prevYear = year;
        let prevMonth = month - 1;
        if (prevMonth < 1) {
            prevMonth = 12;
            prevYear = year - 1;
        }
        const prevKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
        const prevData = fin.months[prevKey];
        if (prevData) {
            const prevInitial = this.getInheritedInitialBalance(prevYear, prevMonth);
            const prevInc = (prevData.income || []).reduce((acc, i) => acc + (i.value || 0), 0);
            const prevExp = (prevData.expenses || []).reduce((acc, e) => acc + (e.value || 0), 0);
            return prevInitial + prevInc - prevExp;
        }

        return 0;
    }

    reconcileFinancesMonths() {
        const fin = this.plugin.settings.finances;
        if (!fin || !fin.months) return;

        // Ensure month arrays are clean and valid without automatically moving items between months
        Object.keys(fin.months).forEach(monthKey => {
            const monthData = fin.months[monthKey];
            if (!monthData) return;

            if (Array.isArray(monthData.expenses)) {
                monthData.expenses = monthData.expenses.filter(exp => exp && typeof exp.value === 'number' && !isNaN(exp.value));
            }
            if (Array.isArray(monthData.income)) {
                monthData.income = monthData.income.filter(inc => inc && typeof inc.value === 'number' && !isNaN(inc.value));
            }
        });
    }

    renderFinancesView(container) {
        const fin = this.plugin.settings.finances;
        if (!fin) return;

        this.reconcileFinancesMonths();

        const curr = fin.currency || 'R$';
        const now = new Date();
        const selYear = fin.selectedYear || now.getFullYear();
        const selMonth = fin.selectedMonth || (now.getMonth() + 1);
        const monthKey = `${selYear}-${String(selMonth).padStart(2, '0')}`;
        const monthData = this.getFinancesMonthData(selYear, selMonth);

        const finContainer = container.createDiv('kt-finances-container');

        // 1. Top Header Bar (Year, Months Navigation, Actions)
        this.renderFinancesHeader(finContainer, selYear, selMonth, monthData, curr);

        // 2. Calculations
        const initialBal = this.getInheritedInitialBalance(selYear, selMonth);
        const totalExpReal = (monthData.expenses || []).reduce((acc, e) => acc + (e.value || 0), 0);
        const totalIncReal = (monthData.income || []).reduce((acc, i) => acc + (i.value || 0), 0);
        const finalBal = initialBal + totalIncReal - totalExpReal;
        const monthSavings = totalIncReal - totalExpReal;
        const savingsPct = initialBal > 0 ? ((monthSavings / initialBal) * 100).toFixed(1) : 0;

        // 3. Two-Column Split Layout
        const splitLayout = finContainer.createDiv('kt-fin-split-layout');

        // Left Column: Despesas & Renda Tables
        const leftCol = splitLayout.createDiv('kt-fin-left-col');
        
        // Sub-tabs switcher on left column (Despesas / Renda / Visão Geral)
        if (!this.finLeftSubTab) this.finLeftSubTab = 'all';

        const subTabWrap = leftCol.createDiv('kt-fin-subtab-bar');
        const subTabLeft = subTabWrap.createDiv('kt-fin-subtab-left');

        const tabs = [
            { id: 'all',      label: 'Visão Completa (Ambos)' },
            { id: 'income',   label: `Renda (${formatCurrency(totalIncReal, curr)})`, count: (monthData.income || []).length },
            { id: 'expenses', label: `Despesas (${formatCurrency(totalExpReal, curr)})`, count: (monthData.expenses || []).length }
        ];

        tabs.forEach(t => {
            const btn = subTabLeft.createEl('button', {
                cls: `kt-fin-subtab-btn ${this.finLeftSubTab === t.id ? 'is-active' : ''}`,
                text: t.label
            });
            btn.onclick = () => {
                this.finLeftSubTab = t.id;
                this.render();
            };
        });

        // Search Input Box
        const searchBox = subTabWrap.createDiv('kt-fin-search-box');
        searchBox.createSpan({ cls: 'kt-fin-search-icon', text: '🔍' });

        const searchInput = searchBox.createEl('input', {
            type: 'text',
            cls: 'kt-fin-search-input',
            attr: {
                placeholder: 'Buscar descrição ou valor...',
                value: this.financesSearchQuery || ''
            }
        });

        let clearBtn = null;
        const updateClearBtn = () => {
            if (this.financesSearchQuery && !clearBtn) {
                clearBtn = searchBox.createEl('button', { cls: 'kt-fin-search-clear', text: '✕' });
                clearBtn.title = 'Limpar busca';
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.financesSearchQuery = '';
                    searchInput.value = '';
                    this.filterFinancesTables(tablesContainer, '');
                    updateClearBtn();
                };
            } else if (!this.financesSearchQuery && clearBtn) {
                clearBtn.remove();
                clearBtn = null;
            }
        };
        updateClearBtn();

        searchInput.oninput = (e) => {
            const val = e.target.value;
            this.financesSearchQuery = val;
            this.filterFinancesTables(tablesContainer, val);
            updateClearBtn();
        };

        const tablesContainer = leftCol.createDiv('kt-fin-tables-scroll');

        // Scroll preservation listeners
        tablesContainer.addEventListener('scroll', () => {
            this.savedFinancesTablesScrollTop = tablesContainer.scrollTop;
        });

        // Click on background of tables container deselects rows
        tablesContainer.addEventListener('click', (e) => {
            if (!e.target.closest('.kt-fin-table tbody tr') && 
                !e.target.closest('.kt-fin-act-btn') && 
                !e.target.closest('.kt-fin-more-dropdown') && 
                !e.target.closest('.kt-fin-selection-floating-bar') && 
                !e.target.closest('.modal') && 
                !e.target.closest('.menu')) {
                this.clearFinanceSelection();
            }
        });

        // Keyboard navigation: press 'F' to center viewport on selected expense/income
        if (!this.financesKeyHandlerAttached) {
            this.financesKeyHandlerAttached = true;
            this.registerDomEvent(window, 'keydown', (e) => {
                // Check if finances view is active in the DOM
                if (!this.containerEl.querySelector('.kt-finances-container')) return;

                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
                    return;
                }

                if (e.key === 'f' || e.key === 'F') {
                    const selectedIds = this.financesSelectedIds && this.financesSelectedIds.size > 0 
                        ? Array.from(this.financesSelectedIds) 
                        : (this.financesSelectedItemId ? [this.financesSelectedItemId] : []);

                    if (selectedIds.length > 0) {
                        e.preventDefault();
                        const targetId = this.financesLastClickedId || selectedIds[0];
                        this.focusFinancesSelectedItem(targetId, true);
                        selectedIds.forEach(id => {
                            const tr = this.containerEl.querySelector(`tr[data-item-id="${id}"]`);
                            if (tr) {
                                tr.removeClass('kt-row-flash');
                                void tr.offsetWidth;
                                tr.addClass('kt-row-flash');
                                setTimeout(() => tr.removeClass('kt-row-flash'), 1000);
                            }
                        });
                    }
                } else if (e.key === 'Escape') {
                    if (this.financesSelectedIds && this.financesSelectedIds.size > 0) {
                        this.clearFinanceSelection();
                    }
                }
            });
        }

        if (this.finLeftSubTab === 'all') {
            // Renda por cima, depois despesas
            this.renderFinancesIncomeTable(tablesContainer, selYear, selMonth, monthData, curr);
            this.renderFinancesExpensesTable(tablesContainer, selYear, selMonth, monthData, curr);
        } else if (this.finLeftSubTab === 'income') {
            this.renderFinancesIncomeTable(tablesContainer, selYear, selMonth, monthData, curr);
        } else if (this.finLeftSubTab === 'expenses') {
            this.renderFinancesExpensesTable(tablesContainer, selYear, selMonth, monthData, curr);
        }

        // Apply search filter if query exists
        if (this.financesSearchQuery) {
            this.filterFinancesTables(tablesContainer, this.financesSearchQuery);
        }

        // Update floating selection summary bar
        this.updateFinancesSelectionBar();

        // Restore scroll position after table render
        if (this.pendingFinancesScrollToItemId) {
            const focusId = this.pendingFinancesScrollToItemId;
            this.pendingFinancesScrollToItemId = null;
            setTimeout(() => {
                this.focusFinancesSelectedItem(focusId, true);
            }, 60);
        } else if (this.savedFinancesTablesScrollTop != null && this.savedFinancesTablesScrollTop > 0) {
            tablesContainer.scrollTop = this.savedFinancesTablesScrollTop;
            requestAnimationFrame(() => {
                if (tablesContainer) tablesContainer.scrollTop = this.savedFinancesTablesScrollTop;
            });
        }

        // Right Column: Balanço Mensal & Orçamento (Dashboard)
        const rightCol = splitLayout.createDiv('kt-fin-right-col');
        rightCol.addEventListener('scroll', () => {
            this.savedFinancesRightColScrollTop = rightCol.scrollTop;
        });

        this.renderFinancesBudgetSummary(rightCol, selYear, selMonth, monthData, curr, initialBal, finalBal, monthSavings, savingsPct, totalExpReal, totalIncReal);

        if (this.savedFinancesRightColScrollTop != null && this.savedFinancesRightColScrollTop > 0) {
            rightCol.scrollTop = this.savedFinancesRightColScrollTop;
            requestAnimationFrame(() => {
                if (rightCol) rightCol.scrollTop = this.savedFinancesRightColScrollTop;
            });
        }
    }

    renderFinancesHeader(parent, year, month, monthData, curr) {
        const fin = this.plugin.settings.finances;
        const header = parent.createDiv('kt-fin-header-bar');

        // Year Selector Group
        const yearGroup = header.createDiv('kt-fin-year-group');
        
        const prevYearBtn = yearGroup.createEl('button', { cls: 'kt-fin-nav-btn', text: '‹' });
        prevYearBtn.title = 'Ano anterior';
        prevYearBtn.onclick = async () => {
            fin.selectedYear = year - 1;
            await this.plugin.saveSettings();
            this.render();
        };

        const yearLabel = yearGroup.createSpan({ cls: 'kt-fin-year-label', text: String(year) });

        const nextYearBtn = yearGroup.createEl('button', { cls: 'kt-fin-nav-btn', text: '›' });
        nextYearBtn.title = 'Próximo ano';
        nextYearBtn.onclick = async () => {
            fin.selectedYear = year + 1;
            await this.plugin.saveSettings();
            this.render();
        };

        // Month Selector Bar (Jan .. Dez)
        const monthBar = header.createDiv('kt-fin-month-bar');
        const monthAbbrs = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const now = new Date();

        monthAbbrs.forEach((abbr, idx) => {
            const mNum = idx + 1;
            const isCurrentMonth = (mNum === (now.getMonth() + 1) && year === now.getFullYear());
            const isSelected = (mNum === month);

            const mBtn = monthBar.createEl('button', {
                cls: `kt-fin-month-btn ${isSelected ? 'is-selected' : ''} ${isCurrentMonth ? 'is-current' : ''}`,
                text: isCurrentMonth ? `${abbr} •` : abbr
            });

            mBtn.onclick = async () => {
                if (fin.selectedMonth !== mNum) {
                    fin.selectedMonth = mNum;
                    await this.plugin.saveSettings();
                    this.render();
                }
            };
        });

        // Actions Group
        const actionsGroup = header.createDiv('kt-fin-actions-group');
        actionsGroup.style.position = 'relative';

        // Import Button
        const importBtn = actionsGroup.createEl('button', {
            cls: 'kt-fin-act-btn mod-cta',
            text: '📥 Importar Planilha'
        });
        importBtn.title = 'Colar dados do Google Sheets ou carregar arquivos CSV';
        importBtn.onclick = () => {
            new FinanceImportModal(this.app, this.plugin, year, month, (res) => {
                this.showUndoImportToast(res);
                this.render();
            }).open();
        };

        // 3-Dots More Options Menu Button (⋯)
        const moreBtn = actionsGroup.createEl('button', {
            cls: 'kt-fin-act-btn kt-fin-more-btn',
            text: '⋯'
        });
        moreBtn.title = 'Mais opções (Limpar planilha, remover duplicados, exportar...)';

        moreBtn.onclick = (e) => {
            e.stopPropagation();
            const existingMenu = actionsGroup.querySelector('.kt-fin-more-dropdown');
            if (existingMenu) {
                existingMenu.remove();
                return;
            }

            const menu = actionsGroup.createDiv('kt-fin-more-dropdown');

            // 1. Remover Duplicados
            const dedupeBtn = menu.createEl('button', {
                cls: 'kt-fin-more-item',
                text: '🧹 Remover Lançamentos Duplicados'
            });
            dedupeBtn.onclick = () => {
                menu.remove();
                this.removeFinanceDuplicates(year, month);
            };

            // 2. Copiar Fixos e Parcelas do Mês Anterior
            const copyFixBtn = menu.createEl('button', {
                cls: 'kt-fin-more-item',
                text: '📋 Buscar Fixos e Parcelas do Mês Anterior'
            });
            copyFixBtn.onclick = async () => {
                menu.remove();
                const res = await this.copyFixedExpensesFromPreviousMonth(year, month);
                if (res.totalAdded > 0) {
                    let msg = '✓ ';
                    if (res.fixedCount > 0 && res.instCount > 0) {
                        msg += `${res.fixedCount} gastos fixos e ${res.instCount} parcelas atualizadas copiados do mês anterior!`;
                    } else if (res.fixedCount > 0) {
                        msg += `${res.fixedCount} gastos fixos copiados do mês anterior!`;
                    } else {
                        msg += `${res.instCount} parcelas atualizadas copiadas do mês anterior!`;
                    }
                    new obsidian.Notice(msg);
                    this.render();
                } else {
                    new obsidian.Notice('Nenhum novo gasto fixo ou parcela pendente para copiar.');
                }
            };

            // 3. Exportar CSV
            const exportBtn = menu.createEl('button', {
                cls: 'kt-fin-more-item',
                text: '📤 Exportar CSV deste Mês'
            });
            exportBtn.onclick = () => {
                menu.remove();
                this.exportFinancesCSV(year, month, monthData);
            };

            menu.createDiv('kt-fin-more-divider');

            // 4. Limpar Mês Atual
            const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            const clearMonthBtn = menu.createEl('button', {
                cls: 'kt-fin-more-item mod-danger',
                text: `🗑️ Apagar Planilha de ${monthNames[month - 1]}/${year}`
            });
            clearMonthBtn.onclick = () => {
                menu.remove();
                this.clearFinancesMonth(year, month);
            };

            // 5. Limpar Todo o Ano
            const clearYearBtn = menu.createEl('button', {
                cls: 'kt-fin-more-item mod-danger',
                text: `⚠️ Apagar Todos os Meses de ${year}`
            });
            clearYearBtn.onclick = () => {
                menu.remove();
                this.clearFinancesYear(year);
            };

            const closeMenuHandler = (docEvt) => {
                if (!menu.contains(docEvt.target) && docEvt.target !== moreBtn) {
                    menu.remove();
                    document.removeEventListener('click', closeMenuHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenuHandler), 10);
        };
    }

    showUndoImportToast(importResult) {
        if (!importResult || (importResult.importedCount === 0 && importResult.duplicateCount === 0)) return;

        // Remove existing toast if any
        if (this.currentUndoToastEl) {
            this.currentUndoToastEl.remove();
            this.currentUndoToastEl = null;
            if (this.undoToastTimer) clearInterval(this.undoToastTimer);
        }

        const toast = document.body.createDiv('kt-fin-undo-toast');
        this.currentUndoToastEl = toast;

        const body = toast.createDiv('kt-fin-undo-toast-body');
        const textWrap = body.createDiv('kt-fin-undo-toast-text');
        
        let msg = `📥 <strong>${importResult.importedCount} novos registros importados.</strong>`;
        if (importResult.duplicateCount > 0) {
            msg += `<br><span style="color:var(--text-muted);font-size:11.5px;">(${importResult.duplicateCount} duplicados ignorados)</span>`;
        }
        textWrap.innerHTML = msg;

        const actions = body.createDiv('kt-fin-undo-toast-actions');
        let timeLeft = 30;

        const undoBtn = actions.createEl('button', {
            cls: 'kt-fin-undo-btn',
            text: `↩ Desfazer (${timeLeft}s)`
        });

        const closeBtn = actions.createEl('button', {
            cls: 'kt-fin-undo-close-btn',
            text: '✕'
        });

        const progressWrap = toast.createDiv('kt-fin-undo-progress-wrap');
        const progressBar = progressWrap.createDiv('kt-fin-undo-progress-bar');

        const disposeToast = () => {
            if (this.undoToastTimer) clearInterval(this.undoToastTimer);
            if (toast && toast.parentNode) toast.remove();
            if (this.currentUndoToastEl === toast) this.currentUndoToastEl = null;
        };

        closeBtn.onclick = disposeToast;

        undoBtn.onclick = async () => {
            disposeToast();
            if (importResult.snapshotBefore) {
                this.plugin.settings.finances.months = importResult.snapshotBefore;
                await this.plugin.saveSettings();
                this.render();
                new obsidian.Notice('✓ Importação desfeita com sucesso! A planilha foi restaurada.');
            }
        };

        const totalMs = 30000;
        const start = Date.now();

        this.undoToastTimer = setInterval(() => {
            const elapsed = Date.now() - start;
            const remainingSec = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
            undoBtn.setText(`↩ Desfazer (${remainingSec}s)`);
            const pct = Math.max(0, 100 - (elapsed / totalMs) * 100);
            progressBar.style.width = `${pct}%`;

            if (elapsed >= totalMs) {
                disposeToast();
            }
        }, 200);
    }

    removeFinanceDuplicates(year, month) {
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        const monthData = this.plugin.settings.finances.months?.[monthKey];
        if (!monthData) {
            new obsidian.Notice('Nenhum dado encontrado neste mês.');
            return;
        }

        let removedCount = 0;

        const dedupeList = (list) => {
            if (!Array.isArray(list)) return [];
            const seen = new Set();
            const unique = [];

            list.forEach(item => {
                const key = `${(item.type || 'expense')}|||${(item.description || '').trim().toLowerCase()}|||${(item.value || 0).toFixed(2)}|||${item.date || ''}|||${item.installment || ''}|||${!!item.isFixed}`;
                if (seen.has(key)) {
                    removedCount++;
                } else {
                    seen.add(key);
                    unique.push(item);
                }
            });
            return unique;
        };

        monthData.expenses = dedupeList(monthData.expenses);
        monthData.income = dedupeList(monthData.income);

        if (removedCount > 0) {
            this.plugin.saveSettings();
            this.render();
            new obsidian.Notice(`✓ ${removedCount} lançamentos duplicados foram removidos deste mês!`);
        } else {
            new obsidian.Notice('Nenhum lançamento duplicado foi encontrado neste mês.');
        }
    }

    clearFinancesMonth(year, month) {
        const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const mName = monthNames[month - 1];

        const confirmModal = new FinanceConfirmModal(
            this.app,
            `🗑️ Apagar Lançamentos de ${mName}/${year}`,
            `Tem certeza que deseja apagar TODOS os lançamentos (despesas e rendas) do mês de ${mName}/${year}? Esta ação não pode ser desfeita.`,
            async () => {
                const monthKey = `${year}-${String(month).padStart(2, '0')}`;
                if (this.plugin.settings.finances.months?.[monthKey]) {
                    this.plugin.settings.finances.months[monthKey].expenses = [];
                    this.plugin.settings.finances.months[monthKey].income = [];
                    await this.plugin.saveSettings();
                    this.render();
                    new obsidian.Notice(`✓ Todos os lançamentos de ${mName}/${year} foram apagados.`);
                }
            }
        );
        confirmModal.open();
    }

    clearFinancesYear(year) {
        const confirmModal = new FinanceConfirmModal(
            this.app,
            `⚠️ Apagar Todo o Ano de ${year}`,
            `Tem certeza que deseja apagar TODOS os lançamentos de todos os 12 meses do ano de ${year}? Esta ação não pode ser desfeita.`,
            async () => {
                let clearedCount = 0;
                for (let m = 1; m <= 12; m++) {
                    const monthKey = `${year}-${String(m).padStart(2, '0')}`;
                    if (this.plugin.settings.finances.months?.[monthKey]) {
                        this.plugin.settings.finances.months[monthKey].expenses = [];
                        this.plugin.settings.finances.months[monthKey].income = [];
                        clearedCount++;
                    }
                }
                await this.plugin.saveSettings();
                this.render();
                new obsidian.Notice(`✓ Planilha de ${year} completamente zerada.`);
            }
        );
        confirmModal.open();
    }

    renderFinancesExpensesTable(parent, year, month, monthData, curr) {
        const fin = this.plugin.settings.finances;
        const section = parent.createDiv('kt-fin-section');

        const secHdr = section.createDiv('kt-fin-section-hdr');
        secHdr.createEl('h3', { text: 'Despesas' });

        const addExpBtn = secHdr.createEl('button', { cls: 'kt-fin-add-btn mod-cta', text: '＋ Nova Despesa' });
        addExpBtn.onclick = () => {
            new FinanceEntryModal(
                this.app,
                this.plugin,
                'expense',
                null,
                year,
                month,
                fin.categories,
                async (newItem) => {
                    if (!monthData.expenses) monthData.expenses = [];
                    monthData.expenses.push(newItem);
                    this.reconcileFinancesMonths();
                    await this.plugin.saveSettings();
                    this.pendingFinancesScrollToItemId = newItem.id;
                    this.financesSelectedItemId = newItem.id;
                    this.render();
                }
            ).open();
        };

        const tableWrap = section.createDiv('kt-fin-table-wrap');
        const table = tableWrap.createEl('table', { cls: 'kt-fin-table' });

        const thead = table.createEl('thead');
        const thr = thead.createEl('tr');
        thr.createEl('th', { text: 'Data' });
        thr.createEl('th', { text: 'Valor' });
        thr.createEl('th', { text: 'Descrição' });
        thr.createEl('th', { text: 'Categoria' });
        thr.createEl('th', { text: 'Ações', cls: 'kt-th-actions' });

        const tbody = table.createEl('tbody');
        const expenses = monthData.expenses || [];

        if (expenses.length === 0) {
            const emptyTr = tbody.createEl('tr');
            const td = emptyTr.createEl('td', { cls: 'kt-td-empty', attr: { colspan: '5' } });
            td.setText('Nenhuma despesa registrada neste mês. Clique em "+ Nova Despesa" ou importe sua planilha.');
            return;
        }

        // Sort expenses: fixed first, then by date ascending
        const sorted = expenses.slice().sort((a, b) => {
            if (a.isFixed && !b.isFixed) return -1;
            if (!a.isFixed && b.isFixed) return 1;
            const dateA = a.date || '';
            const dateB = b.date || '';
            return dateA.localeCompare(dateB);
        });

        sorted.forEach(exp => {
            const hasPendingSplit = exp.splitData && exp.splitData.participants?.some(p => !p.settled);
            const isSelected = this.financesSelectedIds && this.financesSelectedIds.has(exp.id);
            const tr = tbody.createEl('tr', { cls: `${hasPendingSplit ? 'kt-row-split' : ''} ${isSelected ? 'is-selected' : ''}` });
            tr.setAttribute('data-item-id', exp.id);

            // Selection on click with Ctrl/Shift multi-select support
            tr.onclick = (e) => {
                this.handleFinanceRowClick(exp.id, e);
            };

            // Right-click context menu (Copiar para o mês seguinte)
            tr.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const menu = new obsidian.Menu();

                menu.addItem(mItem => {
                    mItem.setTitle('📋 Copiar para o mês seguinte')
                         .setIcon('copy')
                         .onClick(async () => {
                             await this.copyFinanceItemToNextMonth(exp, year, month, 'expense');
                         });
                });

                menu.addSeparator();

                menu.addItem(mItem => {
                    mItem.setTitle('✎ Editar despesa')
                         .setIcon('pencil')
                         .onClick(() => {
                             editBtn.click();
                         });
                });

                menu.addItem(mItem => {
                    mItem.setTitle('✕ Excluir despesa')
                         .setIcon('trash')
                         .onClick(() => {
                             delBtn.click();
                         });
                });

                menu.showAtMouseEvent(e);
            };

            // Attach search text metadata to tr
            const splitNames = (exp.splitData?.participants || []).map(p => (p.name || '')).join(' ');
            const searchIndex = `${exp.description || ''} ${exp.category || ''} ${exp.installment || ''} ${exp.date || ''} ${exp.value || ''} ${formatCurrency(exp.value || 0, curr)} ${splitNames}`.toLowerCase();
            tr.setAttribute('data-search-text', searchIndex);

            // 1. Data / Parcela (Interativo com clique)
            const tdDate = tr.createEl('td', { cls: 'kt-td-date' });
            if (exp.installment) {
                const pill = tdDate.createSpan({ cls: 'kt-fin-installment-pill kt-pill-interactive', text: `(${exp.installment})` });
                pill.title = 'Clique para avançar ou alterar parcelas';
                pill.onclick = (e) => {
                    e.stopPropagation();
                    new FinanceInstallmentPopover(pill, exp.installment, async (newInst) => {
                        exp.installment = newInst;
                        await this.plugin.saveSettings();
                        this.render();
                    }).open();
                };
            } else if (exp.isFixed) {
                const mNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
                const pill = tdDate.createSpan({ cls: 'kt-fin-fixed-pill kt-pill-interactive', text: mNames[month - 1] });
                pill.title = 'Gasto Fixo Mensal • Clique para alterar a data';
                pill.onclick = (e) => {
                    e.stopPropagation();
                    new FinanceDatePickerPopover(pill, exp.date, year, month, async (newDate, isFixed) => {
                        exp.date = newDate;
                        exp.isFixed = isFixed;
                        this.reconcileFinancesMonths();
                        await this.plugin.saveSettings();
                        this.render();
                    }).open();
                };
            } else if (exp.date) {
                const parts = exp.date.split('-');
                const dateText = parts.length === 3 ? `${parts[2]}/${parts[1]}` : exp.date;
                const pill = tdDate.createSpan({ cls: 'kt-fin-date-pill kt-pill-interactive', text: dateText });
                pill.title = 'Clique para escolher outro dia no calendário';
                pill.onclick = (e) => {
                    e.stopPropagation();
                    new FinanceDatePickerPopover(pill, exp.date, year, month, async (newDate, isFixed) => {
                        exp.date = newDate;
                        exp.isFixed = isFixed;
                        this.reconcileFinancesMonths();
                        await this.plugin.saveSettings();
                        this.render();
                    }).open();
                };
            } else {
                tdDate.setText('-');
            }

            // 2. Valor
            const tdVal = tr.createEl('td', { cls: `kt-td-val ${hasPendingSplit ? 'kt-val-split' : ''}` });
            tdVal.setText(formatCurrency(exp.value, curr));

            // 3. Descrição (Desacoplada com badge de Cobrança)
            const tdDesc = tr.createEl('td', { cls: `kt-td-desc ${hasPendingSplit ? 'kt-desc-split' : ''}` });
            tdDesc.createSpan({ text: exp.description, cls: 'kt-fin-desc-text' });

            if (exp.splitData && exp.splitData.participants?.length > 0) {
                const pending = exp.splitData.participants.filter(p => !p.settled).reduce((acc, p) => acc + (p.amount || 0), 0);
                const isPending = pending > 0;
                const badge = tdDesc.createSpan({ cls: `kt-fin-split-badge ${isPending ? 'is-pending' : 'is-settled'}` });
                
                if (isPending) {
                    const partsSummary = exp.splitData.participants.map(p => `${p.name || 'Pessoa'}: ${formatCurrency(p.amount, curr)}${p.settled ? ' (✓)' : ''}`).join(' • ');
                    badge.setText(` • 👥 Cobrar: ${formatCurrency(pending, curr)} (${partsSummary})`);
                } else {
                    badge.setText(' • ✓ Cobrança quitada');
                }
                
                badge.title = 'Clique para gerenciar cobranças e marcar como recebido';
                badge.onclick = (e) => {
                    e.stopPropagation();
                    new FinanceSplitModal(this.app, this.plugin, exp, curr, async (newSplit) => {
                        exp.splitData = newSplit;
                        exp.isSplit = !!(newSplit && newSplit.participants?.length > 0);
                        await this.plugin.saveSettings();
                        this.render();
                    }).open();
                };
            } else if (exp.toCollect) {
                const badge = tdDesc.createSpan({ cls: 'kt-fin-split-badge is-pending', text: ` • Cobrar: ${exp.toCollect}` });
                badge.title = 'Clique para configurar cobrança estruturada';
                badge.onclick = (e) => {
                    e.stopPropagation();
                    new FinanceSplitModal(this.app, this.plugin, exp, curr, async (newSplit) => {
                        exp.splitData = newSplit;
                        exp.isSplit = !!(newSplit && newSplit.participants?.length > 0);
                        await this.plugin.saveSettings();
                        this.render();
                    }).open();
                };
            }

            if (exp.isFixed) {
                tdDesc.createSpan({ cls: 'kt-fin-fixed-badge', text: ' (Fixo)' });
            }

            // 4. Categoria
            const tdCat = tr.createEl('td', { cls: 'kt-td-cat' });
            tdCat.createSpan({ cls: 'kt-fin-cat-pill', text: exp.category || 'Outros' });

            // 5. Ações (Editar & Excluir)
            const tdAct = tr.createEl('td', { cls: 'kt-td-actions' });
            
            const editBtn = tdAct.createEl('button', { cls: 'kt-fin-row-btn', text: '✎' });
            editBtn.title = 'Editar despesa';
            editBtn.onclick = () => {
                new FinanceEntryModal(
                    this.app,
                    this.plugin,
                    'expense',
                    exp,
                    year,
                    month,
                    fin.categories,
                    async (updated) => {
                        this.pendingFinancesScrollToItemId = null;
                        const idx = monthData.expenses.findIndex(x => x.id === exp.id);
                        if (idx !== -1) monthData.expenses[idx] = updated;
                        this.reconcileFinancesMonths();
                        await this.plugin.saveSettings();
                        this.render();
                    },
                    async () => {
                        if (this.financesSelectedItemId === exp.id) {
                            this.financesSelectedItemId = null;
                        }
                        this.pendingFinancesScrollToItemId = null;
                        monthData.expenses = monthData.expenses.filter(x => x.id !== exp.id);
                        await this.plugin.saveSettings();
                        this.render();
                    }
                ).open();
            };

            const delBtn = tdAct.createEl('button', { cls: 'kt-fin-row-btn mod-warning', text: '✕' });
            delBtn.title = 'Excluir despesa';
            delBtn.onclick = async () => {
                if (this.financesSelectedItemId === exp.id) {
                    this.financesSelectedItemId = null;
                }
                this.pendingFinancesScrollToItemId = null;
                monthData.expenses = monthData.expenses.filter(x => x.id !== exp.id);
                await this.plugin.saveSettings();
                this.render();
            };
        });
    }

    renderFinancesIncomeTable(parent, year, month, monthData, curr) {
        const fin = this.plugin.settings.finances;
        const section = parent.createDiv('kt-fin-section');

        const secHdr = section.createDiv('kt-fin-section-hdr');
        secHdr.createEl('h3', { text: 'Renda' });

        const addIncBtn = secHdr.createEl('button', { cls: 'kt-fin-add-btn mod-cta', text: '＋ Nova Renda' });
        addIncBtn.onclick = () => {
            new FinanceEntryModal(
                this.app,
                this.plugin,
                'income',
                null,
                year,
                month,
                fin.incomeCategories,
                async (newItem) => {
                    if (!monthData.income) monthData.income = [];
                    monthData.income.push(newItem);
                    this.reconcileFinancesMonths();
                    await this.plugin.saveSettings();
                    this.pendingFinancesScrollToItemId = newItem.id;
                    this.financesSelectedItemId = newItem.id;
                    this.render();
                }
            ).open();
        };

        const tableWrap = section.createDiv('kt-fin-table-wrap');
        const table = tableWrap.createEl('table', { cls: 'kt-fin-table' });

        const thead = table.createEl('thead');
        const thr = thead.createEl('tr');
        thr.createEl('th', { text: 'Data' });
        thr.createEl('th', { text: 'Valor' });
        thr.createEl('th', { text: 'Descrição' });
        thr.createEl('th', { text: 'Categoria' });
        thr.createEl('th', { text: 'Ações', cls: 'kt-th-actions' });

        const tbody = table.createEl('tbody');
        const incomeList = monthData.income || [];

        if (incomeList.length === 0) {
            const emptyTr = tbody.createEl('tr');
            const td = emptyTr.createEl('td', { cls: 'kt-td-empty', attr: { colspan: '5' } });
            td.setText('Nenhuma renda registrada neste mês.');
            return;
        }

        incomeList.forEach(inc => {
            const isSelected = this.financesSelectedIds && this.financesSelectedIds.has(inc.id);
            const tr = tbody.createEl('tr', { cls: isSelected ? 'is-selected' : '' });
            tr.setAttribute('data-item-id', inc.id);

            // Selection on click with Ctrl/Shift multi-select support
            tr.onclick = (e) => {
                this.handleFinanceRowClick(inc.id, e);
            };

            // Right-click context menu (Copiar para o mês seguinte)
            tr.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const menu = new obsidian.Menu();

                menu.addItem(mItem => {
                    mItem.setTitle('📋 Copiar para o mês seguinte')
                         .setIcon('copy')
                         .onClick(async () => {
                             await this.copyFinanceItemToNextMonth(inc, year, month, 'income');
                         });
                });

                menu.addSeparator();

                menu.addItem(mItem => {
                    mItem.setTitle('✎ Editar renda')
                         .setIcon('pencil')
                         .onClick(() => {
                             editBtn.click();
                         });
                });

                menu.addItem(mItem => {
                    mItem.setTitle('✕ Excluir renda')
                         .setIcon('trash')
                         .onClick(() => {
                             delBtn.click();
                         });
                });

                menu.showAtMouseEvent(e);
            };

            // Attach search text metadata to tr
            const searchIndex = `${inc.description || ''} ${inc.category || ''} ${inc.date || ''} ${inc.value || ''} ${formatCurrency(inc.value || 0, curr)}`.toLowerCase();
            tr.setAttribute('data-search-text', searchIndex);

            // 1. Data (Interativo com clique)
            const tdDate = tr.createEl('td', { cls: 'kt-td-date' });
            if (inc.date) {
                const parts = inc.date.split('-');
                const dateText = parts.length === 3 ? `${parts[2]}/${parts[1]}` : inc.date;
                const pill = tdDate.createSpan({ cls: 'kt-fin-date-pill kt-pill-interactive', text: dateText });
                pill.title = 'Clique para escolher outro dia no calendário';
                pill.onclick = (e) => {
                    e.stopPropagation();
                    new FinanceDatePickerPopover(pill, inc.date, year, month, async (newDate) => {
                        inc.date = newDate;
                        this.reconcileFinancesMonths();
                        await this.plugin.saveSettings();
                        this.render();
                    }).open();
                };
            } else {
                tdDate.setText('-');
            }

            // 2. Valor
            const tdVal = tr.createEl('td', { cls: 'kt-td-val kt-val-green' });
            tdVal.setText(formatCurrency(inc.value, curr));

            // 3. Descrição
            const tdDesc = tr.createEl('td', { cls: 'kt-td-desc' });
            tdDesc.setText(inc.description);

            // 4. Categoria
            const tdCat = tr.createEl('td', { cls: 'kt-td-cat' });
            tdCat.createSpan({ cls: 'kt-fin-cat-pill', text: inc.category || 'Pagamento' });

            // 5. Ações
            const tdAct = tr.createEl('td', { cls: 'kt-td-actions' });
            
            const editBtn = tdAct.createEl('button', { cls: 'kt-fin-row-btn', text: '✎' });
            editBtn.title = 'Editar renda';
            editBtn.onclick = () => {
                new FinanceEntryModal(
                    this.app,
                    this.plugin,
                    'income',
                    inc,
                    year,
                    month,
                    fin.incomeCategories,
                    async (updated) => {
                        this.pendingFinancesScrollToItemId = null;
                        const idx = monthData.income.findIndex(x => x.id === inc.id);
                        if (idx !== -1) monthData.income[idx] = updated;
                        this.reconcileFinancesMonths();
                        await this.plugin.saveSettings();
                        this.render();
                    },
                    async () => {
                        if (this.financesSelectedItemId === inc.id) {
                            this.financesSelectedItemId = null;
                        }
                        this.pendingFinancesScrollToItemId = null;
                        monthData.income = monthData.income.filter(x => x.id !== inc.id);
                        await this.plugin.saveSettings();
                        this.render();
                    }
                ).open();
            };

            const delBtn = tdAct.createEl('button', { cls: 'kt-fin-row-btn mod-warning', text: '✕' });
            delBtn.title = 'Excluir renda';
            delBtn.onclick = async () => {
                if (this.financesSelectedItemId === inc.id) {
                    this.financesSelectedItemId = null;
                }
                this.pendingFinancesScrollToItemId = null;
                monthData.income = monthData.income.filter(x => x.id !== inc.id);
                await this.plugin.saveSettings();
                this.render();
            };
        });
    }

    async copyFinanceItemToNextMonth(item, currentYear, currentMonth, type = 'expense') {
        let nextYear = currentYear;
        let nextMonth = currentMonth + 1;
        if (nextMonth > 12) {
            nextMonth = 1;
            nextYear += 1;
        }

        const nextMonthKey = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
        if (!this.plugin.settings.finances.months[nextMonthKey]) {
            this.plugin.settings.finances.months[nextMonthKey] = {
                plannedBudget: {},
                plannedIncome: {},
                expenses: [],
                income: []
            };
        }
        const nextMonthData = this.plugin.settings.finances.months[nextMonthKey];
        if (!nextMonthData.expenses) nextMonthData.expenses = [];
        if (!nextMonthData.income) nextMonthData.income = [];

        // 1. Calculate next date (same day of month, clamped to days in next month)
        let nextDateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
        if (item.date) {
            const parts = item.date.split('-');
            if (parts.length === 3) {
                const origDay = parseInt(parts[2], 10) || 1;
                const daysInNextMonth = new Date(nextYear, nextMonth, 0).getDate();
                const clampedDay = Math.min(origDay, daysInNextMonth);
                nextDateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
            }
        }

        // 2. Calculate next installment if active
        let nextInstStr = '';
        let nextDesc = item.description || '';

        // Check if installment is in item.installment or in description e.g. "TOKSTOK 1/3" or "Carro (21/36)"
        let instStr = (item.installment || '').trim();
        let descMatch = nextDesc.match(/(?:\(?\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\)?)/);

        if (instStr) {
            const m = instStr.replace(/[()]/g, '').match(/^(\d+)\/(\d+)$/);
            if (m) {
                const cur = parseInt(m[1], 10);
                const tot = parseInt(m[2], 10);
                nextInstStr = `${cur + 1}/${tot}`;
            } else {
                nextInstStr = instStr;
            }
        } else if (descMatch) {
            const cur = parseInt(descMatch[1], 10);
            const tot = parseInt(descMatch[2], 10);
            const nextInst = `${cur + 1}/${tot}`;
            nextDesc = nextDesc.replace(descMatch[0], `(${nextInst})`).trim();
            nextInstStr = nextInst;
        }

        // 3. Clone split / cobrança data with settled reset to false
        let nextSplitData = null;
        if (item.splitData && Array.isArray(item.splitData.participants) && item.splitData.participants.length > 0) {
            nextSplitData = {
                isSplit: true,
                participants: item.splitData.participants.map(p => ({
                    name: p.name || 'Pessoa',
                    amount: p.amount || 0,
                    settled: false // Reset payment status for new month
                })),
                totalToCollect: item.splitData.participants.reduce((acc, p) => acc + (p.amount || 0), 0)
            };
        }

        // 4. Create cloned item
        const newItem = {
            id: `fin-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type: item.type || type,
            value: item.value || 0,
            description: nextDesc,
            category: item.category || (type === 'income' ? 'Pagamento' : 'Outros'),
            date: nextDateStr,
            installment: nextInstStr,
            isFixed: !!item.isFixed,
            isSplit: !!(nextSplitData && nextSplitData.participants?.length > 0),
            splitData: nextSplitData,
            toCollect: item.toCollect || ''
        };

        if (type === 'income') {
            nextMonthData.income.push(newItem);
        } else {
            nextMonthData.expenses.push(newItem);
        }

        await this.plugin.saveSettings();

        const mNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const targetMonthName = mNames[nextMonth - 1] || `Mês ${nextMonth}`;
        const instBadge = nextInstStr ? ` [Parcela: (${nextInstStr})]` : '';
        new obsidian.Notice(`✓ "${newItem.description}" copiado para ${targetMonthName}/${nextYear}${instBadge}!`);
    }

    handleFinanceRowClick(itemId, event) {
        if (!this.financesSelectedIds) this.financesSelectedIds = new Set();

        const isCtrlOrMeta = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        const renderedTrs = Array.from(this.containerEl.querySelectorAll('.kt-fin-table tbody tr[data-item-id]'));
        const allItemIds = renderedTrs.map(tr => tr.getAttribute('data-item-id')).filter(Boolean);

        if (isShift && this.financesLastClickedId && allItemIds.includes(this.financesLastClickedId)) {
            const lastIdx = allItemIds.indexOf(this.financesLastClickedId);
            const curIdx = allItemIds.indexOf(itemId);
            const start = Math.min(lastIdx, curIdx);
            const end = Math.max(lastIdx, curIdx);

            if (!isCtrlOrMeta) {
                this.financesSelectedIds.clear();
            }
            for (let i = start; i <= end; i++) {
                this.financesSelectedIds.add(allItemIds[i]);
            }
        } else if (isCtrlOrMeta) {
            if (this.financesSelectedIds.has(itemId)) {
                this.financesSelectedIds.delete(itemId);
            } else {
                this.financesSelectedIds.add(itemId);
            }
            this.financesLastClickedId = itemId;
        } else {
            // Normal single click
            this.financesSelectedIds.clear();
            this.financesSelectedIds.add(itemId);
            this.financesLastClickedId = itemId;
        }

        this.financesSelectedItemId = this.financesSelectedIds.size > 0 ? (this.financesLastClickedId || Array.from(this.financesSelectedIds)[0]) : null;

        // Update CSS classes
        renderedTrs.forEach(tr => {
            const id = tr.getAttribute('data-item-id');
            if (this.financesSelectedIds.has(id)) {
                tr.addClass('is-selected');
            } else {
                tr.removeClass('is-selected');
            }
        });

        this.updateFinancesSelectionBar();
    }

    updateFinancesSelectionBar() {
        const leftCol = this.containerEl.querySelector('.kt-fin-left-col');
        if (!leftCol) return;

        let bar = leftCol.querySelector('.kt-fin-selection-floating-bar');
        const selectedCount = this.financesSelectedIds ? this.financesSelectedIds.size : 0;

        if (selectedCount === 0) {
            if (bar) bar.remove();
            return;
        }

        if (!bar) {
            bar = leftCol.createDiv('kt-fin-selection-floating-bar');
        } else {
            bar.empty();
        }

        const fin = this.plugin.settings.finances;
        const curr = fin.currency || 'R$';
        const now = new Date();
        const selYear = fin.selectedYear || now.getFullYear();
        const selMonth = fin.selectedMonth || (now.getMonth() + 1);
        const monthData = this.getFinancesMonthData(selYear, selMonth);

        const allItems = [...(monthData.expenses || []), ...(monthData.income || [])];
        const selectedItems = allItems.filter(item => this.financesSelectedIds.has(item.id));
        const totalSum = selectedItems.reduce((acc, item) => acc + (item.value || 0), 0);

        // Stats section
        const stats = bar.createDiv('kt-fin-bar-stats');
        const countBadge = stats.createSpan({ cls: 'kt-fin-bar-count', text: `${selectedCount} ${selectedCount === 1 ? 'despesa/renda' : 'despesas/rendas'}` });
        stats.createSpan({ text: '•' });
        stats.createSpan({ cls: 'kt-fin-bar-sum', text: `Soma: ${formatCurrency(totalSum, curr)}` });

        // Actions section
        const actions = bar.createDiv('kt-fin-bar-actions');

        // Copy all selected to next month button
        const copyBtn = actions.createEl('button', { cls: 'kt-fin-bar-btn', text: '📋 Copiar p/ Próximo Mês' });
        copyBtn.title = 'Copiar todos os itens selecionados para o mês seguinte';
        copyBtn.onclick = async (e) => {
            e.stopPropagation();
            for (const item of selectedItems) {
                const itemType = (monthData.income || []).some(x => x.id === item.id) ? 'income' : 'expense';
                await this.copyFinanceItemToNextMonth(item, selYear, selMonth, itemType);
            }
            new obsidian.Notice(`✓ ${selectedItems.length} itens copiados com sucesso para o próximo mês!`);
        };

        // Clear selection button
        const clearBtn = actions.createEl('button', { cls: 'kt-fin-bar-btn', text: '✕ Desmarcar' });
        clearBtn.title = 'Limpar seleção';
        clearBtn.onclick = (e) => {
            e.stopPropagation();
            this.clearFinanceSelection();
        };

        // Delete all selected button
        const delBtn = actions.createEl('button', { cls: 'kt-fin-bar-btn mod-warning', text: `🗑️ Excluir (${selectedCount})` });
        delBtn.title = 'Excluir itens selecionados';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            const confirmModal = new FinanceConfirmModal(
                this.app,
                `🗑️ Excluir ${selectedCount} itens selecionados`,
                `Tem certeza que deseja excluir os ${selectedCount} itens selecionados no valor total de ${formatCurrency(totalSum, curr)}?`,
                async () => {
                    monthData.expenses = (monthData.expenses || []).filter(x => !this.financesSelectedIds.has(x.id));
                    monthData.income = (monthData.income || []).filter(x => !this.financesSelectedIds.has(x.id));
                    this.clearFinanceSelection();
                    await this.plugin.saveSettings();
                    this.render();
                }
            );
            confirmModal.open();
        };
    }

    clearFinanceSelection() {
        if (this.financesSelectedIds) {
            this.financesSelectedIds.clear();
        }
        this.financesSelectedItemId = null;
        this.financesLastClickedId = null;
        const allTrs = this.containerEl.querySelectorAll('.kt-fin-table tbody tr');
        allTrs.forEach(row => row.removeClass('is-selected'));
        const bar = this.containerEl.querySelector('.kt-fin-selection-floating-bar');
        if (bar) bar.remove();
    }

    focusFinancesSelectedItem(itemId, flash = true) {
        if (!itemId) return;
        const tr = this.containerEl.querySelector(`tr[data-item-id="${itemId}"]`);
        if (tr) {
            tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (flash) {
                tr.removeClass('kt-row-flash');
                void tr.offsetWidth; // trigger reflow
                tr.addClass('kt-row-flash');
                setTimeout(() => tr.removeClass('kt-row-flash'), 1000);
            }
        }
    }

    filterFinancesTables(tablesContainer, rawQuery) {
        if (!tablesContainer) return;
        const q = (rawQuery || '').toLowerCase().trim();

        const sections = tablesContainer.querySelectorAll('.kt-fin-section');
        sections.forEach(sec => {
            const rows = sec.querySelectorAll('tbody tr:not(.kt-tr-empty)');
            let visibleCount = 0;

            rows.forEach(tr => {
                const text = tr.getAttribute('data-search-text') || '';
                if (!q || text.includes(q)) {
                    tr.style.display = '';
                    visibleCount++;
                } else {
                    tr.style.display = 'none';
                }
            });

            // Handle empty state row if all rows are filtered out
            let emptyTr = sec.querySelector('.kt-tr-empty-search');
            if (rows.length > 0 && visibleCount === 0 && q) {
                if (!emptyTr) {
                    const tbody = sec.querySelector('tbody');
                    if (tbody) {
                        emptyTr = tbody.createEl('tr', { cls: 'kt-tr-empty kt-tr-empty-search' });
                        const td = emptyTr.createEl('td', { cls: 'kt-td-empty', attr: { colspan: '5' } });
                        td.setText(`Nenhum lançamento encontrado para "${rawQuery}".`);
                    }
                } else {
                    emptyTr.style.display = '';
                    const td = emptyTr.querySelector('td');
                    if (td) td.setText(`Nenhum lançamento encontrado para "${rawQuery}".`);
                }
            } else if (emptyTr) {
                emptyTr.style.display = 'none';
            }
        });
    }

    renderFinancesBudgetSummary(parent, year, month, monthData, curr, initialBal, finalBal, monthSavings, savingsPct, totalExpReal, totalIncReal) {
        const fin = this.plugin.settings.finances;
        const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const monthName = monthNames[month - 1];

        const summaryCard = parent.createDiv('kt-fin-budget-card');

        // Header with Edit Budget Button
        const cardHdr = summaryCard.createDiv('kt-fin-budget-hdr');
        cardHdr.createEl('h3', { text: `Orçamento Mensal • ${monthName}` });

        const editBudgetBtn = cardHdr.createEl('button', { cls: 'kt-fin-edit-budget-btn', text: '✎ Metas Planejadas' });
        editBudgetBtn.title = 'Editar valores planejados por categoria';
        editBudgetBtn.onclick = () => {
            new FinancePlannedBudgetModal(
                this.app,
                this.plugin,
                year,
                month,
                monthData.plannedExpenses || {},
                monthData.plannedIncome || {},
                fin.categories,
                fin.incomeCategories,
                async (newPlanExp, newPlanInc, applyAll) => {
                    if (applyAll) {
                        for (let m = 1; m <= 12; m++) {
                            const mData = this.getFinancesMonthData(year, m);
                            mData.plannedExpenses = Object.assign({}, newPlanExp);
                            mData.plannedIncome = Object.assign({}, newPlanInc);
                        }
                        new obsidian.Notice(`✓ Metas de orçamento aplicadas para todo o ano de ${year}!`);
                    } else {
                        monthData.plannedExpenses = Object.assign({}, newPlanExp);
                        monthData.plannedIncome = Object.assign({}, newPlanInc);
                        new obsidian.Notice(`✓ Metas salvas para ${monthName}/${year}!`);
                    }
                    await this.plugin.saveSettings();
                    this.render();
                }
            ).open();
        };

        // 1. Top Balance KPI Row
        const totalPendingToCollect = (monthData.expenses || []).reduce((acc, exp) => {
            if (exp.splitData && exp.splitData.participants) {
                return acc + exp.splitData.participants.filter(p => !p.settled).reduce((sum, p) => sum + (p.amount || 0), 0);
            } else if (exp.toCollect) {
                const matchVal = exp.toCollect.match(/(\d+[\.,]?\d*)/);
                return acc + (matchVal ? parseFloat(matchVal[1].replace(',', '.')) : 0);
            }
            return acc;
        }, 0);

        const balanceRow = summaryCard.createDiv(`kt-fin-balance-kpi-row ${totalPendingToCollect > 0 ? 'kt-kpi-4-cols' : ''}`);

        // Saldo Inicial
        const balInitEl = balanceRow.createDiv('kt-fin-kpi-box');
        const initValRow = balInitEl.createDiv('kt-fin-kpi-val-row');
        initValRow.createSpan({ cls: 'kt-fin-kpi-val', text: formatCurrency(initialBal, curr) });
        const editInitBtn = initValRow.createSpan({ cls: 'kt-fin-edit-init-btn', text: '✎' });
        editInitBtn.title = 'Definir saldo inicial personalizado para este mês';
        editInitBtn.onclick = () => {
            new FinanceInitialBalanceModal(this.app, monthData.initialBalance != null ? monthData.initialBalance : initialBal, monthName, year, async (val) => {
                monthData.initialBalance = val;
                await this.plugin.saveSettings();
                this.render();
            }).open();
        };
        balInitEl.createDiv('kt-fin-kpi-lbl').setText('SALDO INICIAL');

        // Saldo Final
        const balFinalEl = balanceRow.createDiv('kt-fin-kpi-box kt-box-orange');
        balFinalEl.createDiv('kt-fin-kpi-val').setText(formatCurrency(finalBal, curr));
        balFinalEl.createDiv('kt-fin-kpi-lbl').setText('SALDO FINAL');

        // Economia do Mês
        const savingsEl = balanceRow.createDiv('kt-fin-kpi-box kt-box-green');
        savingsEl.createDiv('kt-fin-kpi-val').setText(formatCurrency(monthSavings, curr));
        const savingsLbl = monthSavings >= 0 ? `+${savingsPct}% economia` : `${savingsPct}% déficit`;
        savingsEl.createDiv('kt-fin-kpi-lbl').setText(savingsLbl);

        // A Cobrar de Terceiros (se houver pendência no mês)
        if (totalPendingToCollect > 0) {
            const collectEl = balanceRow.createDiv('kt-fin-kpi-box kt-box-red');
            collectEl.createDiv('kt-fin-kpi-val').setText(formatCurrency(totalPendingToCollect, curr));
            collectEl.createDiv('kt-fin-kpi-lbl').setText('A COBRAR');
        }

        // 2. Totals Comparison (Planejado vs Real)
        const plannedExpTotal = Object.values(monthData.plannedExpenses || {}).reduce((acc, v) => acc + (v || 0), 0);
        const plannedIncTotal = Object.values(monthData.plannedIncome || {}).reduce((acc, v) => acc + (v || 0), 0);

        const progressSection = summaryCard.createDiv('kt-fin-progress-section');

        // Despesas Progress
        const expProgRow = progressSection.createDiv('kt-fin-prog-row');
        const expProgLeft = expProgRow.createDiv('kt-fin-prog-left');
        expProgLeft.createSpan({ cls: 'kt-fin-prog-title', text: 'Despesas' });
        expProgLeft.createSpan({ cls: 'kt-fin-prog-meta', text: `Planejado: ${formatCurrency(plannedExpTotal, curr)} • Real: ${formatCurrency(totalExpReal, curr)}` });
        
        const expBarTrack = expProgRow.createDiv('kt-fin-prog-track');
        const expPct = plannedExpTotal > 0 ? Math.min(100, Math.round((totalExpReal / plannedExpTotal) * 100)) : 0;
        const expBarFill = expBarTrack.createDiv(`kt-fin-prog-fill ${totalExpReal > plannedExpTotal && plannedExpTotal > 0 ? 'is-over' : ''}`);
        expBarFill.style.width = `${expPct}%`;

        // Renda Progress
        const incProgRow = progressSection.createDiv('kt-fin-prog-row');
        const incProgLeft = incProgRow.createDiv('kt-fin-prog-left');
        incProgLeft.createSpan({ cls: 'kt-fin-prog-title', text: 'Renda' });
        incProgLeft.createSpan({ cls: 'kt-fin-prog-meta', text: `Planejado: ${formatCurrency(plannedIncTotal, curr)} • Real: ${formatCurrency(totalIncReal, curr)}` });

        const incBarTrack = incProgRow.createDiv('kt-fin-prog-track');
        const incPct = plannedIncTotal > 0 ? Math.min(100, Math.round((totalIncReal / plannedIncTotal) * 100)) : (totalIncReal > 0 ? 100 : 0);
        const incBarFill = incBarTrack.createDiv('kt-fin-prog-fill is-green');
        incBarFill.style.width = `${incPct}%`;

        // 3. Category Comparison Table: Despesas (Planejado vs Real vs Diferença)
        summaryCard.createEl('h4', { cls: 'kt-fin-table-title', text: 'Despesas por Categoria' });
        const expCompTable = summaryCard.createEl('table', { cls: 'kt-fin-comp-table' });
        
        const expThead = expCompTable.createEl('thead');
        const expThr = expThead.createEl('tr');
        expThr.createEl('th', { text: 'Categoria' });
        expThr.createEl('th', { text: 'Planejado' });
        expThr.createEl('th', { text: 'Real' });
        expThr.createEl('th', { text: 'Diferença' });

        const expTbody = expCompTable.createEl('tbody');

        // Totals Row
        const expTotalRow = expTbody.createEl('tr', { cls: 'kt-fin-tot-row' });
        expTotalRow.createEl('td', { text: 'Totais' });
        expTotalRow.createEl('td', { text: formatCurrency(plannedExpTotal, curr) });
        expTotalRow.createEl('td', { text: formatCurrency(totalExpReal, curr) });
        const expTotalDiff = plannedExpTotal - totalExpReal;
        const expTotDiffTd = expTotalRow.createEl('td', { cls: expTotalDiff >= 0 ? 'kt-diff-pos' : 'kt-diff-neg' });
        expTotDiffTd.setText(formatCurrency(expTotalDiff, curr));

        // Group actual expenses by category
        const expByCat = {};
        (monthData.expenses || []).forEach(e => {
            const cat = e.category || 'Outros';
            expByCat[cat] = (expByCat[cat] || 0) + (e.value || 0);
        });

        // Combine all categories that either have a planned value or real expense
        const allExpCats = Array.from(new Set([...(fin.categories || []), ...Object.keys(monthData.plannedExpenses || {}), ...Object.keys(expByCat)]));

        allExpCats.forEach(cat => {
            const planned = monthData.plannedExpenses?.[cat] || 0;
            const real = expByCat[cat] || 0;
            if (planned === 0 && real === 0) return; // Skip completely empty categories

            const diff = planned - real;
            const tr = expTbody.createEl('tr');
            tr.createEl('td', { text: cat, cls: 'kt-td-cat-name' });
            tr.createEl('td', { text: formatCurrency(planned, curr) });
            tr.createEl('td', { text: formatCurrency(real, curr) });
            const diffTd = tr.createEl('td', { cls: diff >= 0 ? 'kt-diff-pos' : 'kt-diff-neg' });
            diffTd.setText(formatCurrency(diff, curr));
        });

        // 4. Category Comparison Table: Renda (Planejado vs Real vs Diferença)
        summaryCard.createEl('h4', { cls: 'kt-fin-table-title', text: 'Renda por Categoria' });
        const incCompTable = summaryCard.createEl('table', { cls: 'kt-fin-comp-table' });

        const incThead = incCompTable.createEl('thead');
        const incThr = incThead.createEl('tr');
        incThr.createEl('th', { text: 'Categoria' });
        incThr.createEl('th', { text: 'Planejado' });
        incThr.createEl('th', { text: 'Real' });
        incThr.createEl('th', { text: 'Diferença' });

        const incTbody = incCompTable.createEl('tbody');

        // Income Totals Row
        const incTotalRow = incTbody.createEl('tr', { cls: 'kt-fin-tot-row' });
        incTotalRow.createEl('td', { text: 'Totais' });
        incTotalRow.createEl('td', { text: formatCurrency(plannedIncTotal, curr) });
        incTotalRow.createEl('td', { text: formatCurrency(totalIncReal, curr) });
        const incTotalDiff = totalIncReal - plannedIncTotal;
        const incTotDiffTd = incTotalRow.createEl('td', { cls: incTotalDiff >= 0 ? 'kt-diff-pos' : 'kt-diff-neg' });
        incTotDiffTd.setText(formatCurrency(incTotalDiff, curr));

        // Group actual income by category
        const incByCat = {};
        (monthData.income || []).forEach(i => {
            const cat = i.category || 'Pagamento';
            incByCat[cat] = (incByCat[cat] || 0) + (i.value || 0);
        });

        const allIncCats = Array.from(new Set([...(fin.incomeCategories || []), ...Object.keys(monthData.plannedIncome || {}), ...Object.keys(incByCat)]));

        allIncCats.forEach(cat => {
            const planned = monthData.plannedIncome?.[cat] || 0;
            const real = incByCat[cat] || 0;
            if (planned === 0 && real === 0) return;

            const diff = real - planned;
            const tr = incTbody.createEl('tr');
            tr.createEl('td', { text: cat, cls: 'kt-td-cat-name' });
            tr.createEl('td', { text: formatCurrency(planned, curr) });
            tr.createEl('td', { text: formatCurrency(real, curr) });
            const diffTd = tr.createEl('td', { cls: diff >= 0 ? 'kt-diff-pos' : 'kt-diff-neg' });
            diffTd.setText(formatCurrency(diff, curr));
        });

        // 5. Cobranças por Pessoa do Mês (Com resumo e botão de copiar mensagem)
        const peopleMap = {};
        (monthData.expenses || []).forEach(exp => {
            if (exp.splitData && exp.splitData.participants) {
                exp.splitData.participants.forEach(p => {
                    const name = (p.name || 'Pessoa').trim();
                    if (!peopleMap[name]) {
                        peopleMap[name] = { name, total: 0, pending: 0, items: [] };
                    }
                    const amt = p.amount || 0;
                    peopleMap[name].total += amt;
                    if (!p.settled) peopleMap[name].pending += amt;
                    peopleMap[name].items.push({
                        desc: exp.description,
                        amount: amt,
                        settled: !!p.settled,
                        date: exp.date,
                        isFixed: exp.isFixed,
                        expenseId: exp.id
                    });
                });
            } else if (exp.toCollect) {
                const matchVal = exp.toCollect.match(/(\d+[\.,]?\d*)/);
                const num = matchVal ? parseFloat(matchVal[1].replace(',', '.')) : 0;
                const name = exp.toCollect.replace(matchVal ? matchVal[0] : '', '').trim() || 'Pessoa';
                if (!peopleMap[name]) {
                    peopleMap[name] = { name, total: 0, pending: 0, items: [] };
                }
                peopleMap[name].total += num;
                peopleMap[name].pending += num;
                peopleMap[name].items.push({
                    desc: exp.description,
                    amount: num,
                    settled: false,
                    date: exp.date,
                    isFixed: exp.isFixed,
                    expenseId: exp.id
                });
            }
        });

        const peopleList = Object.values(peopleMap);
        if (peopleList.length > 0) {
            summaryCard.createEl('h4', { cls: 'kt-fin-table-title', text: '👥 Cobranças do Mês por Pessoa' });
            const splitSummaryWrap = summaryCard.createDiv('kt-fin-people-split-wrap');

            peopleList.forEach(person => {
                const personBox = splitSummaryWrap.createDiv('kt-fin-person-box');
                const pHeader = personBox.createDiv('kt-fin-person-header');

                const nameWrap = pHeader.createDiv('kt-fin-person-name-wrap');
                nameWrap.createSpan({ text: person.name, cls: 'kt-fin-person-name' });

                const isPending = person.pending > 0;
                const statusBadge = nameWrap.createSpan({
                    cls: `kt-fin-person-badge ${isPending ? 'is-pending' : 'is-settled'}`,
                    text: isPending ? `A Cobrar: ${formatCurrency(person.pending, curr)}` : '✓ 100% Pago'
                });

                // Items list breakdown
                const itemsList = personBox.createDiv('kt-fin-person-items');
                person.items.forEach(item => {
                    const itemRow = itemsList.createDiv('kt-fin-person-item-row');
                    
                    let dateDisplay = '';
                    if (item.date && item.date.includes('-')) {
                        const dp = item.date.split('-');
                        if (dp.length === 3) dateDisplay = `${dp[2]}/${dp[1]}`;
                    }
                    if (!dateDisplay) {
                        dateDisplay = item.isFixed ? monthName : '-';
                    }

                    const dateSpan = itemRow.createSpan({ text: `[ ${dateDisplay} ] `, cls: 'kt-fin-pitem-date' });
                    dateSpan.style.color = 'var(--text-muted)';
                    dateSpan.style.fontFamily = 'var(--font-monospace, monospace)';
                    dateSpan.style.fontSize = '11px';

                    const descSpan = itemRow.createSpan({ text: `${item.desc} / `, cls: 'kt-fin-pitem-desc' });
                    itemRow.createSpan({ text: formatCurrency(item.amount, curr), cls: 'kt-fin-pitem-val' });
                    if (item.settled) {
                        itemRow.createSpan({ text: ' (✓ Pago)', cls: 'kt-diff-pos' });
                    }
                });

                // Action Buttons Row
                const pActions = personBox.createDiv('kt-fin-person-actions');
                
                // Copy WhatsApp / Text summary button in requested format
                const copyMsgBtn = pActions.createEl('button', {
                    cls: 'kt-fin-person-copy-btn',
                    text: `📋 Copiar Mensagem (${person.name})`
                });
                copyMsgBtn.title = `Copia os valores no formato padrão para enviar para ${person.name}`;
                copyMsgBtn.onclick = () => {
                    const pendingItems = person.items.filter(it => !it.settled);
                    const itemsToReport = pendingItems.length > 0 ? pendingItems : person.items;
                    
                    const itemsLines = itemsToReport.map(it => {
                        let dateDisplay = '';
                        if (it.date && it.date.includes('-')) {
                            const dp = it.date.split('-');
                            if (dp.length === 3) dateDisplay = `${dp[2]}/${dp[1]}`;
                        }
                        if (!dateDisplay) {
                            dateDisplay = it.isFixed ? monthName : '-';
                        }
                        return `[ ${dateDisplay} ] - ${it.desc} / ${formatCurrency(it.amount, curr)}`;
                    }).join('\n');

                    const totalToReport = pendingItems.length > 0 ? person.pending : person.total;

                    const message = `Segue os valores do mes :\n\n${itemsLines}\n\nTotal : ${formatCurrency(totalToReport, curr)}`;

                    navigator.clipboard.writeText(message);
                    new obsidian.Notice(`✓ Mensagem para ${person.name} copiada com sucesso!`);
                };

                // Quick toggle all settled button
                if (isPending) {
                    const markPaidBtn = pActions.createEl('button', {
                        cls: 'kt-fin-person-settle-btn',
                        text: '✓ Marcar Tudo como Pago'
                    });
                    markPaidBtn.onclick = async () => {
                        (monthData.expenses || []).forEach(exp => {
                            if (exp.splitData && exp.splitData.participants) {
                                exp.splitData.participants.forEach(p => {
                                    if ((p.name || '').toLowerCase().trim() === person.name.toLowerCase().trim()) {
                                        p.settled = true;
                                    }
                                });
                                exp.splitData.totalToCollect = exp.splitData.participants.filter(p => !p.settled).reduce((sum, p) => sum + (p.amount || 0), 0);
                            }
                        });
                        await this.plugin.saveSettings();
                        this.render();
                        new obsidian.Notice(`✓ Cobranças de ${person.name} marcadas como pagas!`);
                    };
                }
            });
        }
    }

    async copyFixedExpensesFromPreviousMonth(year, month) {
        const fin = this.plugin.settings.finances;
        let prevYear = year;
        let prevMonth = month - 1;
        if (prevMonth < 1) {
            prevMonth = 12;
            prevYear = year - 1;
        }

        const prevKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
        const prevData = fin.months[prevKey];
        if (!prevData || !prevData.expenses || prevData.expenses.length === 0) {
            return { fixedCount: 0, instCount: 0, totalAdded: 0 };
        }

        const currentData = this.getFinancesMonthData(year, month);
        if (!currentData.expenses) currentData.expenses = [];

        // Build sets/maps of current month items to prevent duplicates
        const existingFixedDescs = new Set(
            currentData.expenses.filter(e => e.isFixed).map(e => (e.description || '').toLowerCase().trim())
        );

        const existingInstMap = new Map();
        currentData.expenses.forEach(e => {
            const descNorm = (e.description || '').toLowerCase().trim();
            if (e.installment) {
                if (!existingInstMap.has(descNorm)) existingInstMap.set(descNorm, new Set());
                existingInstMap.get(descNorm).add(e.installment.trim());
            }
        });

        let fixedCount = 0;
        let instCount = 0;
        const monthPad = String(month).padStart(2, '0');

        prevData.expenses.forEach(prevExp => {
            const desc = (prevExp.description || '').trim();
            const descNorm = desc.toLowerCase();

            // 1. Process Fixed Expenses
            if (prevExp.isFixed) {
                if (!existingFixedDescs.has(descNorm)) {
                    const cloned = {
                        id: `fin-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        type: 'expense',
                        value: prevExp.value,
                        description: prevExp.description,
                        category: prevExp.category,
                        date: `${year}-${monthPad}-01`,
                        installment: '',
                        isFixed: true,
                        isSplit: prevExp.isSplit || false,
                        splitData: prevExp.splitData ? JSON.parse(JSON.stringify(prevExp.splitData)) : null
                    };
                    currentData.expenses.push(cloned);
                    existingFixedDescs.add(descNorm);
                    fixedCount++;
                }
                return;
            }

            // 2. Process Installments (e.g. "1/2", "24/36", "3/12")
            let instStr = (prevExp.installment || '').trim();
            let parsedDesc = desc;

            // Check if installment is in prevExp.installment or in prevExp.description
            let instMatch = instStr.match(/^(\d+)\s*[\/\-]\s*(\d+)$/);
            if (!instMatch) {
                const descMatch = desc.match(/\(?(\d+)\s*[\/\-]\s*(\d+)\)?/);
                if (descMatch) {
                    instMatch = descMatch;
                    instStr = `${descMatch[1]}/${descMatch[2]}`;
                    parsedDesc = desc.replace(descMatch[0], '').trim();
                }
            }

            if (instMatch) {
                const currentPart = parseInt(instMatch[1], 10);
                const totalParts = parseInt(instMatch[2], 10);

                if (!isNaN(currentPart) && !isNaN(totalParts) && totalParts > 1) {
                    const nextPart = currentPart + 1;

                    // If nextPart exceeds totalParts (e.g. previous was 2/2 -> next is 3/2), DO NOT copy!
                    if (nextPart <= totalParts) {
                        const nextInstStr = `${nextPart}/${totalParts}`;
                        const cleanDescNorm = (parsedDesc || desc).toLowerCase().trim();

                        // Check if current month already has this installment
                        const existingInsts = existingInstMap.get(cleanDescNorm);
                        const alreadyExists = existingInsts && existingInsts.has(nextInstStr);

                        if (!alreadyExists) {
                            const displayDesc = parsedDesc || desc;

                            const cloned = {
                                id: `fin-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                                type: 'expense',
                                value: prevExp.value,
                                description: displayDesc,
                                category: prevExp.category,
                                date: `${year}-${monthPad}-01`,
                                installment: nextInstStr,
                                isFixed: false,
                                isSplit: prevExp.isSplit || false,
                                splitData: prevExp.splitData ? JSON.parse(JSON.stringify(prevExp.splitData)) : null
                            };
                            currentData.expenses.push(cloned);

                            if (!existingInstMap.has(cleanDescNorm)) existingInstMap.set(cleanDescNorm, new Set());
                            existingInstMap.get(cleanDescNorm).add(nextInstStr);
                            instCount++;
                        }
                    }
                }
            }
        });

        const totalAdded = fixedCount + instCount;
        if (totalAdded > 0) {
            await this.plugin.saveSettings();
        }
        return { fixedCount, instCount, totalAdded };
    }

    exportFinancesCSV(year, month, monthData) {
        let csv = '\uFEFF'; // UTF-8 BOM for Excel
        csv += 'Tipo;Data;Valor;Descricao;Categoria;Parcela;Fixo;Split_Cobrar\n';

        (monthData.expenses || []).forEach(e => {
            const desc = `"${(e.description || '').replace(/"/g, '""')}"`;
            const valStr = String(e.value || 0).replace('.', ',');
            const toCol = `"${(e.toCollect || '').replace(/"/g, '""')}"`;
            csv += `Despesa;${e.date || ''};${valStr};${desc};${e.category || ''};${e.installment || ''};${e.isFixed ? 'Sim' : 'Não'};${toCol}\n`;
        });

        (monthData.income || []).forEach(i => {
            const desc = `"${(i.description || '').replace(/"/g, '""')}"`;
            const valStr = String(i.value || 0).replace('.', ',');
            csv += `Renda;${i.date || ''};${valStr};${desc};${i.category || ''};;;;\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const fileName = `Financas_${year}_${String(month).padStart(2, '0')}.csv`;
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        new obsidian.Notice(`✓ Arquivo exportado: ${fileName}`);
    }

    // ----------------------------------------------------------
    // FULL KANBAN BOARD VIEW
    // ----------------------------------------------------------

    renderFullKanban(container) {
        const kanbanWrap = container.createDiv('kt-kanban-full-view');

        const hiddenColumns = this.plugin.settings.hiddenColumns || [];
        const visibleColumns = this.columns.filter(c => !hiddenColumns.includes(c));

        const topBar = kanbanWrap.createDiv('kt-kanban-top-bar');
        const activeCards = this.cards.filter(c => !c.isEvent && c.column !== 'Rotina');
        topBar.createDiv('kt-kanban-stats').setText(
            `${visibleColumns.length} Colunas • ${activeCards.length} Tarefas no total` +
            (hiddenColumns.length > 0 ? ` • ${hiddenColumns.length} ocultas` : '')
        );

        const topBarActions = topBar.createDiv('kt-kanban-top-actions');

        // ── Button: Hide columns ───────────────────────────────────────
        const hideBtn = topBarActions.createEl('button', {
            cls: 'kt-kanban-action-btn',
            text: 'Ocultar Colunas'
        });
        hideBtn.title = 'Selecione colunas para ocultar da visualização';
        hideBtn.onclick = (e) => {
            e.stopPropagation();
            const menu = new obsidian.Menu();

            const allCols = this.columns.filter(c => c !== 'Rotina');
            allCols.forEach(col => {
                const isHidden = hiddenColumns.includes(col);
                menu.addItem(item => {
                    item.setTitle(`${isHidden ? '☐' : '☑'} ${col}`)
                        .onClick(async () => {
                            if (!this.plugin.settings.hiddenColumns) this.plugin.settings.hiddenColumns = [];
                            if (isHidden) {
                                this.plugin.settings.hiddenColumns = this.plugin.settings.hiddenColumns.filter(c => c !== col);
                                new obsidian.Notice(`Coluna "${col}" visível novamente`);
                            } else {
                                this.plugin.settings.hiddenColumns.push(col);
                                new obsidian.Notice(`Coluna "${col}" ocultada`);
                            }
                            await this.plugin.saveSettings();
                            this.render();
                        });
                });
            });

            if (hiddenColumns.length > 0) {
                menu.addSeparator();
                menu.addItem(item => {
                    item.setTitle('Mostrar todas as colunas')
                        .onClick(async () => {
                            this.plugin.settings.hiddenColumns = [];
                            await this.plugin.saveSettings();
                            this.render();
                            new obsidian.Notice('Todas as colunas estão visíveis');
                        });
                });
            }

            menu.showAtMouseEvent(e);
        };

        // ── Button: Add new column ─────────────────────────────────────
        const addColBtn = topBarActions.createEl('button', {
            cls: 'kt-kanban-action-btn kt-kanban-add-col-btn',
            text: '+ Nova Coluna'
        });
        addColBtn.title = 'Criar uma nova coluna no Kanban';

        // Inline form to add a new column (nested inside topBarActions to keep layout aligned)
        const addColForm = topBarActions.createDiv('kt-add-col-form');
        addColForm.style.display = 'none';

        const addColInput = addColForm.createEl('input', {
            cls: 'kt-add-col-input',
            type: 'text',
            attr: { placeholder: 'Nome da nova coluna...' }
        });

        const addColActions = addColForm.createDiv('kt-add-col-actions');
        const addColConfirm = addColActions.createEl('button', { cls: 'kt-btn-confirm-add', text: 'Criar' });
        const addColCancel  = addColActions.createEl('button', { cls: 'kt-btn-cancel-add', text: '✕' });

        const openAddColForm = () => {
            addColBtn.style.display = 'none';
            addColForm.style.display = 'inline-flex';
            addColInput.value = '';
            addColInput.focus();
        };

        const closeAddColForm = () => {
            addColForm.style.display = 'none';
            addColBtn.style.display = '';
        };

        const submitAddCol = async () => {
            const colName = addColInput.value.trim();
            if (!colName) return;
            if (this.columns.map(c => c.toLowerCase()).includes(colName.toLowerCase())) {
                new obsidian.Notice(`Já existe uma coluna chamada "${colName}"`);
                return;
            }
            await this.addColumnToKanban(colName);
            closeAddColForm();
            new obsidian.Notice(`Coluna "${colName}" criada`);
            await this.refresh();
        };

        addColBtn.onclick     = openAddColForm;
        addColCancel.onclick  = closeAddColForm;
        addColConfirm.onclick = submitAddCol;

        addColInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                await submitAddCol();
            } else if (e.key === 'Escape') {
                closeAddColForm();
            }
        });

        const lanesWrap = kanbanWrap.createDiv('kt-kanban-lanes-full');

        // Continuous fluid column dragover across the entire lanes container
        lanesWrap.addEventListener('dragover', (e) => {
            if (!this.draggedColumn) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const lanes = Array.from(lanesWrap.querySelectorAll('.kt-lane'));
            if (lanes.length === 0) return;

            const clientX = e.clientX;
            const draggedIdx = lanes.findIndex(l => l.dataset.columnName === this.draggedColumn);
            if (draggedIdx === -1) return;

            // Compute center X of each visible lane
            const midpoints = lanes.map(lane => {
                const rect = lane.getBoundingClientRect();
                return rect.left + rect.width / 2;
            });

            // Find target slot index (from 0 to lanes.length)
            let targetSlot = 0;
            while (targetSlot < lanes.length && clientX > midpoints[targetSlot]) {
                targetSlot++;
            }

            // Remove existing indicator classes from all lanes
            lanes.forEach(l => l.classList.remove('kt-col-drop-before', 'kt-col-drop-after'));

            // If targetSlot is draggedIdx or draggedIdx + 1, it represents the column's current position -> no move
            if (targetSlot === draggedIdx || targetSlot === draggedIdx + 1) {
                this.columnDropTarget = null;
                return;
            }

            if (targetSlot < draggedIdx) {
                // Moving left: place indicator BEFORE lanes[targetSlot]
                lanes[targetSlot].classList.add('kt-col-drop-before');
                this.columnDropTarget = {
                    targetCol: lanes[targetSlot].dataset.columnName,
                    isAfter: false
                };
            } else {
                // Moving right: place indicator AFTER lanes[targetSlot - 1]
                lanes[targetSlot - 1].classList.add('kt-col-drop-after');
                this.columnDropTarget = {
                    targetCol: lanes[targetSlot - 1].dataset.columnName,
                    isAfter: true
                };
            }
        });

        lanesWrap.addEventListener('dragleave', (e) => {
            if (this.draggedColumn && !lanesWrap.contains(e.relatedTarget)) {
                lanesWrap.querySelectorAll('.kt-col-drop-before, .kt-col-drop-after')
                    .forEach(l => l.classList.remove('kt-col-drop-before', 'kt-col-drop-after'));
                this.columnDropTarget = null;
            }
        });

        lanesWrap.addEventListener('drop', async (e) => {
            if (!this.draggedColumn) return;
            const draggedCol = this.draggedColumn;
            const dropTarget = this.columnDropTarget;
            this.draggedColumn = null;
            this.columnDropTarget = null;

            e.preventDefault();
            e.stopPropagation();

            lanesWrap.querySelectorAll('.kt-column-is-dragging, .kt-col-drop-before, .kt-col-drop-after')
                .forEach(el => el.classList.remove('kt-column-is-dragging', 'kt-col-drop-before', 'kt-col-drop-after'));

            if (dropTarget && dropTarget.targetCol && dropTarget.targetCol !== draggedCol) {
                await this.reorderKanbanColumn(draggedCol, dropTarget.targetCol, dropTarget.isAfter);
            }
        });

        // Group ALL cards by column (including Done) — only visible columns
        const grouped = {};
        visibleColumns.forEach(col => { grouped[col] = []; });
        this.cards.forEach(c => {
            if (c.isEvent || c.column === 'Rotina') return;
            if (!grouped[c.column]) return; // skip cards from hidden columns
            grouped[c.column].push(c);
        });

        visibleColumns.forEach(colName => {
            const colCards = grouped[colName] || [];
            this.renderKanbanLane(lanesWrap, colName, colCards, true);
        });
    }

    // ----------------------------------------------------------
    // RESIZABLE & COLLAPSIBLE BACKLOG (MINI-KANBAN LANES)
    // ----------------------------------------------------------

    renderBacklogDrawer(container, unscheduled) {
        const drawer = container.createDiv('kt-backlog-drawer');

        if (!this.backlogCollapsed) {
            drawer.style.height = `${this.backlogHeight}px`;
        } else {
            drawer.addClass('kt-collapsed');
        }

        // 1. Draggable Top Resize Handle
        const handle = drawer.createDiv('kt-resize-handle');
        handle.title = 'Clique e arraste para redimensionar / Duplo clique para minimizar';
        this.setupResizeHandle(handle, drawer);

        // 2. Backlog Header Bar
        const header = drawer.createDiv('kt-backlog-header');

        const titleBox = header.createDiv('kt-backlog-title-box');
        const icon = titleBox.createSpan({ cls: 'kt-collapse-icon', text: this.backlogCollapsed ? '▶' : '▼' });
        titleBox.createSpan({ cls: 'kt-backlog-title-text', text: 'QUADRO KANBAN' });
        
        const countBadge = titleBox.createSpan('kt-badge-count');
        const activeCards = this.cards.filter(c => !c.isEvent && c.column !== 'Rotina');
        countBadge.setText(`${unscheduled.length} sem data • ${activeCards.length} total`);

        const toggleBtn = header.createEl('button', {
            cls: 'kt-backlog-toggle-btn',
            text: this.backlogCollapsed ? '▲ Expandir Painel' : '▼ Minimizar'
        });

        const toggleCollapse = async () => {
            this.backlogCollapsed = !this.backlogCollapsed;
            this.plugin.settings.backlogCollapsed = this.backlogCollapsed;
            await this.plugin.saveSettings();
            this.render();
        };

        titleBox.onclick  = toggleCollapse;
        toggleBtn.onclick = toggleCollapse;
        handle.ondblclick = toggleCollapse;

        // 3. Backlog Content: Columns / Lanes matching Kanban
        if (!this.backlogCollapsed) {
            const content = drawer.createDiv('kt-backlog-content');
            const lanesWrap = content.createDiv('kt-backlog-lanes');

            // Group unscheduled cards by column
            const grouped = {};
            this.columns.forEach(col => { grouped[col] = []; });
            
            unscheduled.forEach(c => {
                if (!grouped[c.column]) grouped[c.column] = [];
                grouped[c.column].push(c);
            });

            this.columns.forEach(colName => {
                if (isIgnoredColumn(colName)) return;
                const colCards = grouped[colName] || [];
                this.renderKanbanLane(lanesWrap, colName, colCards, false);
            });
        }
    }

    renderKanbanLane(container, colName, colCards, isFullView = false) {
        const isDevCol = colName.trim().toLowerCase().replace(/[\s-_]/g, '') === 'indevelopment';
        // Minimização de colunas se aplica APENAS na aba Kanban cheia (isFullView === true)
        // No Cronograma (Backlog Drawer), todas as colunas permanecem sempre 100% abertas
        const isCollapsed = isFullView && (this.plugin.settings.collapsedColumns || []).includes(colName);

        const lane = container.createDiv('kt-lane');
        lane.dataset.columnName = colName;
        if (isDevCol) lane.addClass('kt-lane-in-development');
        if (isCollapsed) lane.addClass('kt-lane-collapsed');

        const colColor = getProjectColor([], colName, this.plugin.settings.columnColors);

        const toggleColumnCollapse = async (e) => {
            if (!isFullView) return;
            if (e) e.stopPropagation();
            if (!this.plugin.settings.collapsedColumns) this.plugin.settings.collapsedColumns = [];
            if (isCollapsed) {
                this.plugin.settings.collapsedColumns = this.plugin.settings.collapsedColumns.filter(c => c !== colName);
            } else {
                this.plugin.settings.collapsedColumns.push(colName);
            }
            await this.plugin.saveSettings();
            this.render();
        };

        // Helper to enable dragging columns
        const setupColumnDrag = (headerEl) => {
            if (!isFullView) return;
            headerEl.draggable = true;
            headerEl.addClass('kt-lane-hdr-draggable');
            headerEl.title = headerEl.title || `Arraste para reordenar a coluna "${colName}"`;

            headerEl.addEventListener('dragstart', (e) => {
                if (e.target.closest('button, input, textarea, .kt-lane-collapse-btn, .kt-lane-color-dot, .kt-lane-quick-add, .kt-lane-menu-btn')) {
                    e.preventDefault();
                    return;
                }
                this.draggedColumn = colName;
                this.columnDropTarget = null;
                this.draggedCard = null;
                e.dataTransfer.setData('text/plain', colName);
                e.dataTransfer.effectAllowed = 'move';
                lane.addClass('kt-column-is-dragging');
            });

            headerEl.addEventListener('dragend', async () => {
                const draggedCol = this.draggedColumn;
                const dropTarget = this.columnDropTarget;
                this.draggedColumn = null;
                this.columnDropTarget = null;

                document.querySelectorAll('.kt-column-is-dragging, .kt-col-drop-before, .kt-col-drop-after')
                    .forEach(el => el.classList.remove('kt-column-is-dragging', 'kt-col-drop-before', 'kt-col-drop-after'));

                // Reliable fallback if drop event was not caught by lanesWrap
                if (draggedCol && dropTarget && dropTarget.targetCol && dropTarget.targetCol !== draggedCol) {
                    await this.reorderKanbanColumn(draggedCol, dropTarget.targetCol, dropTarget.isAfter);
                }
            });
        };

        // Setup drop for cards (and fallback for columns)
        lane.addEventListener('dragover', (e) => {
            if (this.draggedColumn) return; // handled by lanesWrap continuous tracker
            if (!this.draggedCard) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            lane.classList.add('kt-lane-drop-hover');
        });

        lane.addEventListener('dragleave', (e) => {
            if (this.draggedColumn) return;
            if (!lane.contains(e.relatedTarget)) {
                lane.classList.remove('kt-lane-drop-hover');
            }
        });

        lane.addEventListener('drop', async (e) => {
            if (this.draggedColumn) return; // handled by lanesWrap
            if (!this.draggedCard) return;
            e.preventDefault();
            e.stopPropagation();
            lane.classList.remove('kt-lane-drop-hover');
            document.querySelectorAll('.kt-drop-above, .kt-drop-below').forEach(el => el.classList.remove('kt-drop-above', 'kt-drop-below'));

            const card = this.draggedCard;
            this.draggedCard = null;

            if (card.column !== colName) {
                await this.moveCardToColumn(card, colName);
                await this.refresh();
            }
        });

        // 1. If Column is Collapsed (Vertical Strip) - only in full view
        if (isCollapsed) {
            lane.title = `Coluna minimizada: ${colName} (${colCards.length} cards) — clique para expandir`;
            lane.onclick = toggleColumnCollapse;

            const laneHdr = lane.createDiv('kt-lane-header');
            setupColumnDrag(laneHdr);
            
            const expandBtn = laneHdr.createSpan({ cls: 'kt-lane-collapse-btn', text: '▶' });
            expandBtn.title = 'Expandir coluna';

            const colorDot = laneHdr.createSpan('kt-lane-color-dot');
            colorDot.style.backgroundColor = colColor;

            laneHdr.createSpan({ cls: 'kt-lane-count', text: String(colCards.length) });

            laneHdr.createSpan({ cls: 'kt-lane-vertical-title', text: colName });
            return;
        }

        // 2. Expanded Lane Header
        const laneHdr = lane.createDiv('kt-lane-header');
        setupColumnDrag(laneHdr);
        if (isFullView) laneHdr.ondblclick = toggleColumnCollapse;

        const colorDot = laneHdr.createSpan('kt-lane-color-dot');
        colorDot.style.backgroundColor = colColor;
        colorDot.title = `Cor da coluna: ${colName} (clique para alterar)`;
        colorDot.onclick = (e) => {
            e.stopPropagation();
            new ColumnColorModal(this.app, this.plugin, colName, colColor, () => this.refresh()).open();
        };

        laneHdr.createSpan({ cls: 'kt-lane-title', text: colName });
        laneHdr.createSpan({ cls: 'kt-lane-count', text: String(colCards.length) });

        // Workload Total in Column Header
        const totalColMinutes = colCards.reduce((acc, c) => acc + (c.estimateMinutes || 0), 0);
        if (totalColMinutes > 0) {
            const hoursBadge = laneHdr.createSpan({ cls: 'kt-lane-hours-badge', text: formatMinutesToHours(totalColMinutes) });
            hoursBadge.title = `Carga total estimada nesta coluna: ${formatMinutesToHours(totalColMinutes)}`;
            if (isDevCol && totalColMinutes > 480) {
                hoursBadge.addClass('is-overloaded');
                hoursBadge.title += ' (Atenção: mais de 8h de trabalho em progresso!)';
            }
        }

        const quickAddBtn = laneHdr.createSpan({ cls: 'kt-lane-quick-add', text: '＋' });
        quickAddBtn.title = `Adicionar card em ${colName}`;

        if (isFullView) {
            const openColMenu = (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                const menu = new obsidian.Menu();

                const curIdx = this.columns.indexOf(colName);
                if (curIdx > 0) {
                    menu.addItem(item => {
                        item.setTitle('Mover para a Esquerda')
                            .onClick(async () => {
                                const targetCol = this.columns[curIdx - 1];
                                await this.reorderKanbanColumn(colName, targetCol, false);
                            });
                    });
                }

                if (curIdx !== -1 && curIdx < this.columns.length - 1) {
                    menu.addItem(item => {
                        item.setTitle('Mover para a Direita')
                            .onClick(async () => {
                                const targetCol = this.columns[curIdx + 1];
                                await this.reorderKanbanColumn(colName, targetCol, true);
                            });
                    });
                }

                menu.addSeparator();

                menu.addItem(item => {
                    item.setTitle('Alterar Cor')
                        .onClick(() => {
                            new ColumnColorModal(this.app, this.plugin, colName, colColor, () => this.refresh()).open();
                        });
                });

                menu.addItem(item => {
                    item.setTitle('Ocultar Coluna')
                        .onClick(async () => {
                            if (!this.plugin.settings.hiddenColumns) this.plugin.settings.hiddenColumns = [];
                            if (!this.plugin.settings.hiddenColumns.includes(colName)) {
                                this.plugin.settings.hiddenColumns.push(colName);
                                await this.plugin.saveSettings();
                                this.render();
                                new obsidian.Notice(`Coluna "${colName}" ocultada`);
                            }
                        });
                });

                menu.addItem(item => {
                    item.setTitle('Minimizar Coluna')
                        .onClick(async () => {
                            await toggleColumnCollapse();
                        });
                });

                menu.addSeparator();

                menu.addItem(item => {
                    item.setTitle('Excluir Coluna')
                        .onClick(() => {
                            new ConfirmDeleteColumnModal(this.app, colName, colCards.length, async () => {
                                await this.deleteColumnFromKanban(colName);
                            }).open();
                        });
                });

                menu.showAtMouseEvent(evt);
            };

            const menuBtn = laneHdr.createSpan({ cls: 'kt-lane-menu-btn', text: '⋮' });
            menuBtn.title = `Opções da coluna "${colName}"`;
            menuBtn.onclick = openColMenu;

            laneHdr.addEventListener('contextmenu', openColMenu);

            const collapseBtn = laneHdr.createSpan({ cls: 'kt-lane-collapse-btn', text: '◀' });
            collapseBtn.title = `Minimizar coluna ${colName}`;
            collapseBtn.onclick = toggleColumnCollapse;
        }

        // 3. Lane Cards List (Drop Target for dragging cards between columns)
        const laneCards = lane.createDiv('kt-lane-cards');

        if (colCards.length === 0) {
            laneCards.createDiv('kt-lane-empty').setText('Sem cards');
        } else {
            colCards.forEach(card => {
                this.renderKanbanCard(laneCards, card);
            });
        }

        // 3. Lane Footer (+ Adicionar Card)
        const footer = lane.createDiv('kt-lane-footer');
        const addBtn = footer.createEl('button', {
            cls: 'kt-add-card-btn',
            text: '+ Adicionar card'
        });

        const form = footer.createDiv('kt-add-card-form');
        form.style.display = 'none';

        const input = form.createEl('textarea', {
            cls: 'kt-new-card-input',
            attr: { placeholder: 'Digite o título do card...', rows: '2' }
        });
        new CardTextareaSuggester(this.app, input, () => this.cards.flatMap(c => c.tags));

        const btnRow = form.createDiv('kt-add-card-actions');
        const confirmBtn = btnRow.createEl('button', {
            cls: 'kt-btn-confirm-add',
            text: 'Adicionar card'
        });
        const cancelBtn = btnRow.createEl('button', {
            cls: 'kt-btn-cancel-add',
            text: '✕'
        });

        const openForm = () => {
            addBtn.style.display = 'none';
            form.style.display = 'flex';
            input.value = '';
            input.focus();
        };

        const closeForm = () => {
            form.style.display = 'none';
            addBtn.style.display = 'flex';
            input.value = '';
        };

        const submitForm = async () => {
            const val = input.value.trim();
            if (val) {
                await this.addCardToColumn(colName, val);
                input.value = '';
                input.focus();
                await this.refresh();
            }
        };

        addBtn.onclick = openForm;
        quickAddBtn.onclick = openForm;
        cancelBtn.onclick = closeForm;
        confirmBtn.onclick = submitForm;

        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                await submitForm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeForm();
            }
        });
    }

    renderKanbanCard(container, card) {
        const cardEl = container.createDiv('kt-lane-card');
        cardEl.dataset.lineIndex = String(card.lineIndex);
        cardEl.style.setProperty('--proj-color', card.tagColor || card.projectColor || 'transparent');
        if (card.priorityColor) cardEl.style.setProperty('--prio-color', card.priorityColor);

        if (card.isCompleted) {
            cardEl.addClass('is-completed');
        }

        // Se este card estiver em modo de edição inline:
        if (this.editingCardLineIndex === card.lineIndex) {
            this.renderInlineCardEditor(cardEl, card);
            return;
        }

        // Circular check / completion toggle for main card
        const chk = cardEl.createSpan('kt-card-check');
        chk.setText(card.isCompleted ? '✓' : '○');
        chk.title = card.isCompleted ? 'Marcar como pendente' : 'Marcar como concluído';
        chk.onclick = async (e) => {
            e.stopPropagation();
            await this.toggleCardCompletion(card);
            await this.refresh();
        };

        // Card Body
        const body = cardEl.createDiv('kt-card-body');
        
        // Title
        const titleEl = body.createDiv('kt-c-title');
        renderFormattedTextWithLinks(titleEl, card.title, this.app, this.plugin.settings.kanbanFile);

        // Images (![[...]])
        if (card.images && card.images.length > 0) {
            const imgContainer = body.createDiv('kt-card-images');
            card.images.forEach(imgRef => {
                renderCardImage(imgContainer, imgRef, this.app);
            });
        }

        // Subtasks (Checklists - [ ] and - [x])
        if (card.subtasks && card.subtasks.length > 0) {
            const subtasksWrap = body.createDiv('kt-card-subtasks');
            
            const completedCount = card.subtasks.filter(s => s.completed).length;
            const progress = subtasksWrap.createDiv('kt-subtask-progress');
            progress.setText(`${completedCount}/${card.subtasks.length}`);

            const subtasksList = subtasksWrap.createDiv('kt-subtask-items');
            card.subtasks.forEach(st => {
                const item = subtasksList.createDiv('kt-subtask-item');
                const stChk = item.createSpan('kt-subtask-chk');
                stChk.setText(st.completed ? '✓' : '○');
                stChk.title = st.completed ? 'Marcar como pendente' : 'Concluir subtarefa';
                stChk.onclick = async (e) => {
                    e.stopPropagation();
                    await this.toggleSubtaskCompletion(st.lineIndex);
                    await this.refresh();
                };

                const stText = item.createSpan('kt-subtask-label');
                if (st.completed) stText.addClass('is-completed');
                renderFormattedTextWithLinks(stText, st.text, this.app, this.plugin.settings.kanbanFile);
            });
        }

        // Bullet Points (- item without [ ])
        if (card.bullets && card.bullets.length > 0) {
            const bulletsWrap = body.createDiv('kt-card-bullets');
            card.bullets.forEach(b => {
                const bItem = bulletsWrap.createDiv('kt-card-bullet-item');
                bItem.createSpan({ cls: 'kt-bullet-dot', text: '•' });
                const bLabel = bItem.createSpan('kt-bullet-label');
                renderFormattedTextWithLinks(bLabel, b.text, this.app, this.plugin.settings.kanbanFile);
            });
        }

        // Notes & Note Links ([[Trip]])
        if (card.notes && card.notes.length > 0) {
            const notesWrap = body.createDiv('kt-card-notes');
            card.notes.forEach(noteLine => {
                const nLine = notesWrap.createDiv('kt-card-note-line');
                renderFormattedTextWithLinks(nLine, noteLine, this.app, this.plugin.settings.kanbanFile);
            });
        }

        // Tags & Meta badges in the footer row
        const metaRow = body.createDiv('kt-card-meta-row');
        this.renderTagPills(metaRow, card.tags, true);

        // Estimate Badge
        if (card.estimateMinutes && card.estimateMinutes > 0) {
            const estBadge = metaRow.createSpan('kt-card-est-badge');
            estBadge.setText(`⏱ ${card.estimateText}`);
            estBadge.title = `Estimativa: ${card.estimateText}`;
        }

        if (card.startDate) {
            const dateChip = metaRow.createSpan('kt-card-date-chip');
            const dText = sameDay(card.startDate, card.endDate || card.startDate)
                ? formatDate(card.startDate).slice(0, 5)
                : `${formatDate(card.startDate).slice(0, 5)}..${formatDate(card.endDate || card.startDate).slice(0, 5)}`;
            dateChip.setText(dText);
            dateChip.title = `Agendado: ${formatDate(card.startDate)} – ${formatDate(card.endDate || card.startDate)}`;
        }

        // 3-Dots Options Menu Button (•••)
        const menuBtn = cardEl.createSpan({ cls: 'kt-card-menu-btn', text: '···' });
        menuBtn.title = 'Opções do card';
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            this.openCardOptionsModal(card);
        };

        // Click no corpo do card inicia a edição inline no próprio card
        cardEl.onclick = (e) => {
            if (e.target.closest('.kt-card-check') || e.target.closest('.kt-subtask-chk') || e.target.closest('.kt-card-menu-btn')) return;
            this.startInlineCardEdit(card);
        };

        cardEl.title = `${card.title} — clique para editar no card`;
        cardEl.setAttribute('draggable', 'true');

        cardEl.addEventListener('dragstart', (e) => {
            this.draggedCard = card;
            e.dataTransfer.setData('text/plain', card.id);
            e.dataTransfer.effectAllowed = 'move';
            cardEl.classList.add('kt-dragging');
            document.body.classList.add('kt-is-card-dragging');
        });

        // Hover over card: detect top half (above) or bottom half (below)
        cardEl.addEventListener('dragover', (e) => {
            if (!this.draggedCard || this.draggedCard.lineIndex === card.lineIndex) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';

            const rect = cardEl.getBoundingClientRect();
            const midY = rect.top + (rect.height / 2);

            if (e.clientY < midY) {
                cardEl.classList.add('kt-drop-above');
                cardEl.classList.remove('kt-drop-below');
            } else {
                cardEl.classList.add('kt-drop-below');
                cardEl.classList.remove('kt-drop-above');
            }
        });

        cardEl.addEventListener('dragleave', (e) => {
            if (!cardEl.contains(e.relatedTarget)) {
                cardEl.classList.remove('kt-drop-above', 'kt-drop-below');
            }
        });

        // Drop on card: insert directly above or below
        cardEl.addEventListener('drop', async (e) => {
            if (!this.draggedCard || this.draggedCard.lineIndex === card.lineIndex) return;
            e.preventDefault();
            e.stopPropagation();

            const rect = cardEl.getBoundingClientRect();
            const isAbove = e.clientY < (rect.top + rect.height / 2);
            cardEl.classList.remove('kt-drop-above', 'kt-drop-below');

            const sourceCard = this.draggedCard;
            this.draggedCard = null;

            await this.moveCardRelative(sourceCard, card, isAbove ? 'above' : 'below');
            await this.refresh();
        });

        cardEl.addEventListener('dragend', () => {
            cardEl.classList.remove('kt-dragging', 'kt-drop-above', 'kt-drop-below');
            document.querySelectorAll('.kt-drop-above, .kt-drop-below').forEach(el => el.classList.remove('kt-drop-above', 'kt-drop-below'));
            document.body.classList.remove('kt-is-card-dragging');
            this.draggedCard = null;
        });
    }

    setupResizeHandle(handle, drawer) {
        let startY = 0;
        let startH = 0;

        const onPointerDown = (e) => {
            if (this.backlogCollapsed) return;
            startY = e.clientY;
            startH = drawer.getBoundingClientRect().height;
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            e.preventDefault();
        };

        const onPointerMove = (e) => {
            const delta = startY - e.clientY; // dragging up increases height
            const newH  = Math.max(120, Math.min(window.innerHeight - 200, startH + delta));
            drawer.style.height = `${newH}px`;
            this.backlogHeight = newH;
        };

        const onPointerUp = async () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
            this.plugin.settings.backlogHeight = this.backlogHeight;
            await this.plugin.saveSettings();
        };

        handle.addEventListener('pointerdown', onPointerDown);
    }

    // ----------------------------------------------------------
    // TIMEBLOCK VIEW (1-Day & Week Multi-Day)
    // ----------------------------------------------------------

    renderTimeblock(container) {
        const subView = this.plugin.settings.timeblockSubView || 'day';
        if (subView === 'week') {
            this.renderWeekTimeblock(container);
        } else {
            const split = container.createDiv('kt-tb-split');
            this.renderTbSidebar(split);
            this.renderDayGrid(split);
        }
    }

    renderWeekTimeblock(container) {
        const ws          = this.getWeekStart();
        const dayStart    = this.plugin.settings.dayStart;
        const dayEnd      = this.plugin.settings.dayEnd;
        const SLOT_HEIGHT = 36; // px per 30 min
        const PX_PER_MIN  = SLOT_HEIGHT / 30; // 1.2 px per min
        const TOTAL_HEIGHT = (dayEnd - dayStart + 1) * 60 * PX_PER_MIN;

        const split = container.createDiv('kt-tb-split kt-tb-week-split');

        // Sidebar with Backlog
        const sidebar = split.createDiv('kt-tb-sidebar kt-tb-week-sidebar');
        if (this.savedSidebarScrollTop !== undefined && this.savedSidebarScrollTop !== null) {
            sidebar.scrollTop = this.savedSidebarScrollTop;
        }

        // Section: BACKLOG GERAL SEM DATA
        const unscheduled = this.cards.filter(c => !c.startDate && !c.isCompleted && !c.isEvent && c.column !== 'Rotina' && !isIgnoredColumn(c.column));
        sidebar.createEl('p', { cls: 'kt-section-label', text: `📋 BACKLOG GERAL (${unscheduled.length})` });
        if (unscheduled.length === 0) {
            const emptyNotice = sidebar.createDiv('kt-empty');
            emptyNotice.setText('Nenhum card no backlog.');
        } else {
            unscheduled.forEach(card => {
                const c = sidebar.createDiv('kt-sb-card');
                c.style.setProperty('--proj-color', card.tagColor || card.projectColor || 'transparent');
                if (card.priorityColor) c.style.setProperty('--prio-color', card.priorityColor);
                c.createDiv('kt-c-title').setText(card.title);
                const metaRow = c.createDiv('kt-card-meta-row');
                this.renderTagPills(metaRow, card.tags, true);
                if (card.estimateMinutes && card.estimateMinutes > 0) {
                    const estBadge = metaRow.createSpan('kt-card-est-badge');
                    estBadge.setText(`⏱ ${card.estimateText}`);
                }
                c.title = 'Arraste para qualquer dia da semana para agendar horário';
                c.setAttribute('draggable', 'true');

                c.addEventListener('dragstart', (e) => {
                    this.draggedCard = card;
                    e.dataTransfer.setData('text/plain', card.id);
                    e.dataTransfer.effectAllowed = 'move';
                    c.classList.add('kt-dragging');
                    document.body.classList.add('kt-is-card-dragging');
                });

                c.addEventListener('dragend', () => {
                    c.classList.remove('kt-dragging');
                    document.body.classList.remove('kt-is-card-dragging');
                    this.draggedCard = null;
                });

                c.onclick = () => this.openCardOptionsModal(card);
            });
        }

        // Main MultiDayView
        const main = split.createDiv('kt-tb-main kt-tb-week-main');

        const hideWeekends = !!this.plugin.settings.timeblockHideWeekends;
        const daysCount   = hideWeekends ? 5 : 7;

        // Week Title Header
        const we = new Date(ws); we.setDate(we.getDate() + (daysCount - 1));
        const hdr = main.createDiv('kt-tb-day-header kt-tb-week-day-header');
        hdr.createEl('span', { cls: 'kt-tb-day-title', text: `Semana: ${this.dayLabel(ws, false)} — ${this.dayLabel(we, false)}` });

        // Sticky Header Row for Weekday Columns
        const headerRow = main.createDiv('kt-tb-week-header-row');
        headerRow.createDiv('kt-tb-week-axis-spacer'); // Left spacer for time axis

        const headersWrap = headerRow.createDiv('kt-tb-week-headers-wrap');
        headersWrap.style.gridTemplateColumns = `repeat(${daysCount}, minmax(0, 1fr))`;

        const days = [];
        for (let i = 0; i < daysCount; i++) {
            const d = new Date(ws);
            d.setDate(d.getDate() + i);
            days.push(d);

            const isToday = sameDay(d, new Date());
            const isSel = this.selectedDay && sameDay(d, this.selectedDay);
            const isWeekend = (d.getDay() === 0 || d.getDay() === 6);

            const hdCell = headersWrap.createDiv(`kt-tb-week-hd-cell${isToday ? ' kt-is-today' : ''}${isSel ? ' kt-selected' : ''}${isWeekend ? ' kt-is-weekend' : ''}`);
            
            const titleSpan = hdCell.createSpan('kt-tb-week-hd-title');
            titleSpan.setText(this.dayLabel(d));

            if (isToday) {
                const todayTag = hdCell.createSpan('kt-tb-today-pill');
                todayTag.setText('Hoje');
            }
            
            const dayScheduled = this.cards.filter(c => {
                if (c.isEvent || c.column === 'Rotina') return false;
                if (!c.startDate) return false;
                const s = startOfDay(c.startDate);
                const e = endOfDay(c.endDate || c.startDate);
                return startOfDay(d) >= s && startOfDay(d) <= e;
            });
            if (dayScheduled.length > 0) {
                const badge = hdCell.createSpan('kt-day-badge');
                badge.setText(String(dayScheduled.length));
            }

            hdCell.title = `Clique para abrir ${this.dayLabel(d)} no modo 1 Dia`;
            hdCell.onclick = () => {
                this.selectedDay = d;
                this.plugin.settings.timeblockSubView = 'day';
                this.plugin.saveSettings();
                this.render();
            };
        }

        // Scroll Area with shared time axis and day columns
        const scrollArea = main.createDiv('kt-tb-scroll-area kt-tb-week-scroll-area');
        const schedWrap = scrollArea.createDiv('kt-tb-schedule-wrapper kt-tb-week-sched-wrap');

        // Restore scroll position
        if (this.savedTbScrollTop !== undefined && this.savedTbScrollTop !== null) {
            scrollArea.scrollTop = this.savedTbScrollTop;
            requestAnimationFrame(() => {
                if (scrollArea) scrollArea.scrollTop = this.savedTbScrollTop;
            });
        } else {
            const now = new Date();
            const currentH = now.getHours();
            const targetMin = Math.max(0, (currentH - 1 - dayStart) * 60);
            scrollArea.scrollTop = targetMin * PX_PER_MIN;
        }

        // 1. Shared Left Time Axis
        const timeAxis = schedWrap.createDiv('kt-tb-time-axis kt-tb-week-time-axis');
        for (let h = dayStart; h <= dayEnd; h++) {
            const lbl00 = timeAxis.createDiv('kt-tb-hour-lbl');
            lbl00.setText(`${String(h).padStart(2, '0')}:00`);

            const lbl30 = timeAxis.createDiv('kt-tb-hour-lbl kt-tb-half');
            lbl30.setText(`${String(h).padStart(2, '0')}:30`);
        }

        // 2. Multi-Day Columns Container
        const colsWrap = schedWrap.createDiv('kt-tb-week-cols-wrap');
        colsWrap.style.height = `${TOTAL_HEIGHT}px`;
        colsWrap.style.gridTemplateColumns = `repeat(${daysCount}, minmax(0, 1fr))`;

        days.forEach((day) => {
            const isToday = sameDay(day, new Date());
            const isWeekend = (day.getDay() === 0 || day.getDay() === 6);
            const isSel = this.selectedDay && sameDay(day, this.selectedDay);

            const dayCol = colsWrap.createDiv(`kt-tb-week-day-col${isToday ? ' kt-is-today' : ''}${isWeekend ? ' kt-is-weekend' : ''}${isSel ? ' kt-selected' : ''}`);
            dayCol.style.height = `${TOTAL_HEIGHT}px`;

            // Background Grid Slots with exact lines matching daily view!
            const slotsLayer = dayCol.createDiv('kt-tb-slots-layer');
            const dayCards = this.cards.filter(c => {
                if (!c.startDate) return false;
                const s = startOfDay(c.startDate);
                const e = endOfDay(c.endDate || c.startDate);
                return startOfDay(day) >= s && startOfDay(day) <= e;
            });

            for (let h = dayStart; h <= dayEnd; h++) {
                const s00 = slotsLayer.createDiv('kt-tb-slot-line');
                s00.style.height = `${SLOT_HEIGHT}px`;
                s00.onclick = () => this.onSlotClick(h, 0, dayCards, day);
                s00.addEventListener('contextmenu', (e) => this.openSlotContextMenu(e, day, h, 0));

                const s30 = slotsLayer.createDiv('kt-tb-slot-line kt-tb-half-line');
                s30.style.height = `${SLOT_HEIGHT}px`;
                s30.onclick = () => this.onSlotClick(h, 30, dayCards, day);
                s30.addEventListener('contextmenu', (e) => this.openSlotContextMenu(e, day, h, 30));
            }

            // Events Layer
            const eventsLayer = dayCol.createDiv('kt-tb-events-layer');

            const timedCards = dayCards.filter(c => !!getTimeForDay(c, day));
            const remoteEvents = this.getRemoteEventsForDay(day);
            const allDayItems = [...timedCards, ...remoteEvents];

            const layoutMap = this.computeTimeblockLayout(allDayItems, day);
            allDayItems.forEach(card => {
                const layoutInfo = layoutMap.get(card.id || card.uid || card.lineIndex);
                this.renderTbCard(eventsLayer, card, day, dayStart, dayEnd, PX_PER_MIN, layoutInfo);
            });

            // Live Now Indicator on current day
            if (isToday) {
                const now = new Date();
                const currentMin = now.getHours() * 60 + now.getMinutes();
                const startMin = dayStart * 60;
                const endMin = (dayEnd + 1) * 60;
                if (currentMin >= startMin && currentMin <= endMin) {
                    const topPx = (currentMin - startMin) * PX_PER_MIN;
                    const indicator = eventsLayer.createDiv('kt-tb-now-indicator');
                    indicator.style.top = `${topPx}px`;
                    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                    const badge = indicator.createSpan('kt-tb-now-badge');
                    badge.setText(timeStr);
                    indicator.createDiv('kt-tb-now-dot');
                    indicator.createDiv('kt-tb-now-line');
                }
            }

            // Drag & Drop on day column
            dayCol.addEventListener('dragover', (e) => {
                if (!this.draggedCard) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                dayCol.classList.add('kt-tb-col-drop-hover');
            });
            dayCol.addEventListener('dragleave', (e) => {
                if (!dayCol.contains(e.relatedTarget)) {
                    dayCol.classList.remove('kt-tb-col-drop-hover');
                }
            });
            dayCol.addEventListener('drop', async (e) => {
                if (!this.draggedCard) return;
                e.preventDefault();
                dayCol.classList.remove('kt-tb-col-drop-hover');

                const rect = dayCol.getBoundingClientRect();
                const relY = e.clientY - rect.top;
                const totalMinutes = dayStart * 60 + Math.round((relY / PX_PER_MIN) / 15) * 15;
                const startHours = Math.min(dayEnd, Math.max(dayStart, Math.floor(totalMinutes / 60)));
                const startMins = totalMinutes % 60;

                const card = this.draggedCard;
                this.draggedCard = null;

                const estMin = (card.estimateMinutes && card.estimateMinutes > 0) ? card.estimateMinutes : 60;
                const endTotalMin = startHours * 60 + startMins + estMin;
                const endHours = Math.floor(endTotalMin / 60);
                const endMins = endTotalMin % 60;

                const pad = n => String(n).padStart(2, '0');
                const ts = `${pad(startHours)}:${pad(startMins)}`;
                const te = `${pad(endHours)}:${pad(endMins)}`;

                await this.persistTimeBlock(card, day, ts, te);
                await this.refresh();
            });
        });
    }

    renderTbSidebar(parent) {
        const sidebar = parent.createDiv('kt-tb-sidebar');
        if (this.savedSidebarScrollTop !== undefined && this.savedSidebarScrollTop !== null) {
            sidebar.scrollTop = this.savedSidebarScrollTop;
        }
        const ws      = this.getWeekStart();
        const day     = this.selectedDay || new Date();

        sidebar.createEl('p', { cls: 'kt-section-label', text: 'SEMANA' });

        for (let i = 0; i < 7; i++) {
            const d   = new Date(ws); d.setDate(d.getDate() + i);
            const btn = sidebar.createDiv('kt-sb-day');

            const isToday = sameDay(d, new Date());
            const isSel   = sameDay(d, day);

            if (isToday) btn.addClass('kt-is-today');
            if (isSel)   btn.addClass('kt-selected');

            // Day name + date
            const nameEl = btn.createSpan(); nameEl.setText(this.dayLabel(d));

            // Badge: how many cards on this day (excluding routine blocks)
            const dayCards = this.cards.filter(c => {
                if (c.isEvent || c.column === 'Rotina') return false;
                if (!c.startDate) return false;
                const s = startOfDay(c.startDate);
                const e = endOfDay(c.endDate || c.startDate);
                return startOfDay(d) >= s && startOfDay(d) <= e;
            });
            if (dayCards.length) {
                const badge = btn.createSpan('kt-day-badge');
                badge.setText(String(dayCards.length));
            }

            btn.onclick = () => { 
                this.selectedDay = d; 
                this.savedTbScrollTop = null; 
                this.render(); 
            };
        }

        // Section 1: TAREFAS DO CRONOGRAMA DESTE DIA (Exclui blocos de rotina/reunião)
        const dayCards = this.cards.filter(c => {
            if (c.isEvent || c.column === 'Rotina') return false;
            if (!c.startDate) return false;
            const s = startOfDay(c.startDate);
            const e = endOfDay(c.endDate || c.startDate);
            return startOfDay(day) >= s && startOfDay(day) <= e;
        });

        if (dayCards.length > 0) {
            sidebar.createEl('p', { cls: 'kt-section-label kt-section-today-label', text: `📅 DO CRONOGRAMA (${dayCards.length})` });
            dayCards.forEach(card => {
                const isDone = card.isCompleted || isIgnoredColumn(card.column);
                const c = sidebar.createDiv(`kt-sb-card kt-sb-card-scheduled${isDone ? ' is-completed' : ''}`);
                c.style.setProperty('--proj-color', card.tagColor || card.projectColor || 'transparent');
                if (card.priorityColor) c.style.setProperty('--prio-color', card.priorityColor);
                
                const dayTime = getTimeForDay(card, day);
                if (dayTime) {
                    c.createDiv('kt-tb-card-time').setText(`⏰ ${dayTime.timeStart} – ${dayTime.timeEnd}`);
                }

                c.createDiv('kt-c-title').setText(isDone ? `✓ ${card.title}` : card.title);
                const metaRow = c.createDiv('kt-card-meta-row');
                this.renderTagPills(metaRow, card.tags, true);
                if (card.estimateMinutes && card.estimateMinutes > 0) {
                    const estBadge = metaRow.createSpan('kt-card-est-badge');
                    estBadge.setText(`⏱ ${card.estimateText}`);
                }
                const matchedProj = getProjectForCard(card, this.plugin.settings.projects);
                if (matchedProj && matchedProj.hourlyRate > 0) {
                    let minCount = 0;
                    if (dayTime) {
                        minCount = Math.max(15, timeToMinutes(dayTime.timeEnd || dayTime.timeStart) - timeToMinutes(dayTime.timeStart));
                    } else if (card.estimateMinutes && card.estimateMinutes > 0) {
                        minCount = card.estimateMinutes;
                    }
                    if (minCount > 0) {
                        const amount = (minCount / 60) * matchedProj.hourlyRate;
                        const curr = matchedProj.currency || 'R$';
                        const earnBadge = metaRow.createSpan('kt-card-earnings-badge');
                        earnBadge.setText(`💵 ${formatCurrency(amount, curr)}`);
                        earnBadge.title = `Ganho previsto: ${formatCurrency(amount, curr)} (${curr} ${matchedProj.hourlyRate}/h)`;
                    }
                }
                
                c.title = 'Arraste para a grade de horários ou clique para abrir detalhes';
                c.setAttribute('draggable', 'true');

                c.addEventListener('dragstart', (e) => {
                    this.draggedCard = card;
                    e.dataTransfer.setData('text/plain', card.id);
                    e.dataTransfer.effectAllowed = 'move';
                    c.classList.add('kt-dragging');
                    document.body.classList.add('kt-is-card-dragging');
                });

                c.addEventListener('dragend', () => {
                    c.classList.remove('kt-dragging');
                    document.body.classList.remove('kt-is-card-dragging');
                    this.draggedCard = null;
                });

                c.onclick = () => {
                    this.openCardOptionsModal(card, day);
                };
            });
        }

        // Section 2: BACKLOG GERAL SEM DATA (Exclui blocos de rotina/reunião)
        const unscheduled = this.cards.filter(c => !c.startDate && !c.isCompleted && !c.isEvent && c.column !== 'Rotina' && !isIgnoredColumn(c.column));
        if (unscheduled.length > 0) {
            sidebar.createEl('p', { cls: 'kt-section-label', text: `📋 BACKLOG GERAL (${unscheduled.length})` });
            unscheduled.forEach(card => {
                const c = sidebar.createDiv('kt-sb-card');
                c.style.setProperty('--proj-color', card.tagColor || card.projectColor || 'transparent');
                if (card.priorityColor) c.style.setProperty('--prio-color', card.priorityColor);
                c.createDiv('kt-c-title').setText(card.title);
                const metaRow = c.createDiv('kt-card-meta-row');
                this.renderTagPills(metaRow, card.tags, true);
                if (card.estimateMinutes && card.estimateMinutes > 0) {
                    const estBadge = metaRow.createSpan('kt-card-est-badge');
                    estBadge.setText(`⏱ ${card.estimateText}`);
                }
                const matchedProj = getProjectForCard(card, this.plugin.settings.projects);
                if (matchedProj && matchedProj.hourlyRate > 0 && card.estimateMinutes > 0) {
                    const amount = (card.estimateMinutes / 60) * matchedProj.hourlyRate;
                    const curr = matchedProj.currency || 'R$';
                    const earnBadge = metaRow.createSpan('kt-card-earnings-badge');
                    earnBadge.setText(`💵 ${formatCurrency(amount, curr)}`);
                    earnBadge.title = `Ganho previsto: ${formatCurrency(amount, curr)} (${curr} ${matchedProj.hourlyRate}/h)`;
                }
                c.title = 'Arraste para a grade de horários ou clique para abrir detalhes';
                c.setAttribute('draggable', 'true');

                c.addEventListener('dragstart', (e) => {
                    this.draggedCard = card;
                    e.dataTransfer.setData('text/plain', card.id);
                    e.dataTransfer.effectAllowed = 'move';
                    c.classList.add('kt-dragging');
                    document.body.classList.add('kt-is-card-dragging');
                });

                c.addEventListener('dragend', () => {
                    c.classList.remove('kt-dragging');
                    document.body.classList.remove('kt-is-card-dragging');
                    this.draggedCard = null;
                });

                c.onclick = () => this.openCardOptionsModal(card);
            });
        }
    }

    renderDayGrid(parent) {
        const day  = this.selectedDay || new Date();
        const main = parent.createDiv('kt-tb-main');

        const hdr = main.createDiv('kt-tb-day-header');
        hdr.createEl('span', { cls: 'kt-tb-day-title', text: this.dayLabelFull(day) });

        const scrollArea = main.createDiv('kt-tb-scroll-area');
        const schedWrap  = scrollArea.createDiv('kt-tb-schedule-wrapper');

        const dayStart    = this.plugin.settings.dayStart;
        const dayEnd      = this.plugin.settings.dayEnd;
        const SLOT_HEIGHT = 36; // px por slot de 30 min
        const PX_PER_MIN  = SLOT_HEIGHT / 30; // 1.2 px por minuto

        // Restore or initialize scroll position
        if (this.savedTbScrollTop !== undefined && this.savedTbScrollTop !== null) {
            scrollArea.scrollTop = this.savedTbScrollTop;
            requestAnimationFrame(() => {
                if (scrollArea) scrollArea.scrollTop = this.savedTbScrollTop;
            });
        } else {
            const now = new Date();
            if (sameDay(day, now)) {
                const currentH = now.getHours();
                const targetMin = Math.max(0, (currentH - 1 - dayStart) * 60);
                scrollArea.scrollTop = targetMin * PX_PER_MIN;
            }
        }
        
        // 1. Régua de Horários Fixa (Left Axis)
        const timeAxis = schedWrap.createDiv('kt-tb-time-axis');
        for (let h = dayStart; h <= dayEnd; h++) {
            const lbl00 = timeAxis.createDiv('kt-tb-hour-lbl');
            lbl00.setText(`${String(h).padStart(2, '0')}:00`);

            const lbl30 = timeAxis.createDiv('kt-tb-hour-lbl kt-tb-half');
            lbl30.setText(`${String(h).padStart(2, '0')}:30`);

            const now = new Date();
            if (sameDay(day, now) && now.getHours() === h) {
                lbl00.addClass('kt-current-hour');
            }
        }

        // 2. Área de Grade (Right: Slots de Fundo + Camada de Eventos Absolutos)
        const gridArea    = schedWrap.createDiv('kt-tb-grid-area');
        const gridSlots   = gridArea.createDiv('kt-tb-grid-slots');
        const eventsLayer = gridArea.createDiv('kt-tb-events-layer');

        // Cards agendados para este dia (INCLUINDO CARDS COMPLETADOS / DONE E BLOCOS DE ROTINA)
        const dayCards = this.cards.filter(c => {
            if (!c.startDate) return false;
            const s = startOfDay(c.startDate);
            const e = endOfDay(c.endDate || c.startDate);
            return startOfDay(day) >= s && startOfDay(day) <= e;
        });

        // Setup dos slots de fundo (Drop targets e clique)
        for (let h = dayStart; h <= dayEnd; h++) {
            [0, 30].forEach(m => {
                const slotLine = gridSlots.createDiv(m === 0 ? 'kt-tb-slot-line' : 'kt-tb-slot-line kt-tb-half-line');
                const slotMinutes = h * 60 + m;
                slotLine.dataset.slotMinutes = String(slotMinutes);

                const now = new Date();
                if (sameDay(day, now) && now.getHours() === h) {
                    slotLine.addClass('kt-current-hour-slot');
                }

                // Drop target para cards vindos do Sidebar
                slotLine.addEventListener('dragover', (e) => {
                    if (!this.draggedCard) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    slotLine.classList.add('kt-slot-drop-hover');
                });

                slotLine.addEventListener('dragleave', () => {
                    slotLine.classList.remove('kt-slot-drop-hover');
                });

                slotLine.addEventListener('drop', async (e) => {
                    if (!this.draggedCard) return;
                    e.preventDefault();
                    slotLine.classList.remove('kt-slot-drop-hover');

                    const card = this.draggedCard;
                    this.draggedCard = null;

                    const startMinutes = slotMinutes;
                    let duration = 60;
                    const existingDayTime = getTimeForDay(card, day);
                    if (existingDayTime) {
                        const dur = timeToMinutes(existingDayTime.timeEnd) - timeToMinutes(existingDayTime.timeStart);
                        if (dur > 0) duration = dur;
                    }
                    const endMinutes = Math.min((dayEnd + 1) * 60, startMinutes + duration);

                    const ts = minutesToTime(startMinutes);
                    const te = minutesToTime(endMinutes);

                    // 1. Preservar intervalos de múltiplos dias do Cronograma
                    if (!card.startDate) {
                        // Card do Backlog Geral (sem data) -> define este dia como início e fim
                        await this.persistDateRange(card, day, day);
                    } else {
                        // Card já tem data/intervalo no Cronograma
                        const cardStart = startOfDay(card.startDate);
                        const cardEnd   = endOfDay(card.endDate || card.startDate);
                        const targetDay = startOfDay(day);

                        if (targetDay < cardStart) {
                            // Dia é anterior ao início -> expande o início
                            await this.persistDateRange(card, day, card.endDate || card.startDate);
                        } else if (targetDay > cardEnd) {
                            // Dia é posterior ao término -> expande o término
                            await this.persistDateRange(card, card.startDate, day);
                        }
                        // Se targetDay estiver entre cardStart e cardEnd, MANTÉM intacto o intervalo multi-dias!
                    }

                    // 2. Salva o horário apenas deste dia específico (mantendo todos os outros dias)
                    await this.persistTimeBlock(card, day, ts, te);
                    await this.refresh();
                });

                // Clique esquerdo para agendar task existente
                slotLine.onclick = () => this.onSlotClick(h, m, dayCards, day);

                // Clique DIREITO para abrir Menu de Criação de Pausas / Reuniões / Blocos especiais
                slotLine.addEventListener('contextmenu', (e) => this.openSlotContextMenu(e, day, h, m));
            });
        }

        // 3. Renderização dos Cards na Camada de Eventos Absolutos (com layout anti-sobreposição)
        const timedCards = dayCards.filter(c => !!getTimeForDay(c, day));
        const remoteEvents = this.getRemoteEventsForDay(day);
        const allDayItems = [...timedCards, ...remoteEvents];
        const layoutMap = this.computeTimeblockLayout(allDayItems, day);
        allDayItems.forEach(card => {
            const layoutInfo = layoutMap.get(card.id || card.uid || card.lineIndex);
            this.renderTbCard(eventsLayer, card, day, dayStart, dayEnd, PX_PER_MIN, layoutInfo);
        });

        // 4. Linha de Guia do Horário Atual (Now Indicator - Guiando o olhar no ponto exato do dia)
        if (sameDay(day, new Date())) {
            const now = new Date();
            const currentMin = now.getHours() * 60 + now.getMinutes();
            const startMin = dayStart * 60;
            const endMin = (dayEnd + 1) * 60;

            if (currentMin >= startMin && currentMin <= endMin) {
                const topPx = (currentMin - startMin) * PX_PER_MIN;

                const indicator = eventsLayer.createDiv('kt-tb-now-indicator');
                indicator.style.top = `${topPx}px`;

                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

                const badge = indicator.createSpan('kt-tb-now-badge');
                badge.setText(timeStr);

                indicator.createDiv('kt-tb-now-dot');
                indicator.createDiv('kt-tb-now-line');
            }
        }
    }

    openSlotContextMenu(e, day, h, m) {
        e.preventDefault();
        e.stopPropagation();

        const menu = new obsidian.Menu();

        menu.addItem(item => {
            item.setTitle('➕ Nova Tarefa do Kanban...')
                .setIcon('plus')
                .onClick(() => {
                    const dayCards = this.cards.filter(c => {
                        if (!c.startDate) return false;
                        const s = startOfDay(c.startDate);
                        const e = endOfDay(c.endDate || c.startDate);
                        return startOfDay(day) >= s && startOfDay(day) <= e;
                    });
                    this.onSlotClick(h, m, dayCards, day);
                });
        });

        menu.addSeparator();

        menu.addItem(item => {
            item.setTitle('☕ Pausa / Café (15 min)')
                .setIcon('coffee')
                .onClick(async () => {
                    await this.createTimeEvent('☕ Pausa', day, h, m, 15, 'break');
                });
        });

        menu.addItem(item => {
            item.setTitle('🍽️ Almoço / Refeição (1h)')
                .setIcon('utensils')
                .onClick(async () => {
                    await this.createTimeEvent('🍽️ Almoço', day, h, m, 60, 'break');
                });
        });

        menu.addItem(item => {
            item.setTitle('👥 Reunião (30 min)')
                .setIcon('users')
                .onClick(async () => {
                    await this.createTimeEvent('👥 Reunião', day, h, m, 30, 'meeting');
                });
        });

        menu.addItem(item => {
            item.setTitle('🎯 Bloco de Foco (1h)')
                .setIcon('target')
                .onClick(async () => {
                    await this.createTimeEvent('🎯 Bloco de Foco', day, h, m, 60, 'focus');
                });
        });

        menu.addSeparator();

        menu.addItem(item => {
            item.setTitle('✍️ Bloco Personalizado / Recorrente...')
                .setIcon('plus-circle')
                .onClick(() => {
                    new CustomEventModal(this.app, day, h, m, async (title, start, end, type, repeatRule, customDays, repeatWeeks) => {
                        await this.createCustomTimeEvent(title, day, start, end, type, repeatRule, customDays, repeatWeeks);
                    }).open();
                });
        });

        menu.showAtMouseEvent(e);
    }

    getRemoteEventsForDay(day) {
        if (!this.plugin.remoteEventsCache || this.plugin.remoteEventsCache.length === 0) return [];
        const hiddenList = this.plugin.settings.hiddenRemoteEvents || [];
        const dayKey = formatDate(day);

        return this.plugin.remoteEventsCache.filter(evt => {
            if (!sameDay(evt.startDate, day)) return false;

            const instanceKey = `${evt.calendarId || ''}::${evt.uid || ''}::${dayKey}`;
            const seriesKey = `${evt.calendarId || ''}::${evt.uid || ''}`;

            if (hiddenList.includes(instanceKey) || 
                hiddenList.includes(seriesKey) || 
                (evt.id && hiddenList.includes(evt.id))) {
                return false;
            }
            return true;
        });
    }

    async hideRemoteEvent(card, scope = 'single') {
        if (!this.plugin.settings.hiddenRemoteEvents) {
            this.plugin.settings.hiddenRemoteEvents = [];
        }

        const dayKey = formatDate(card.startDate);
        const instanceKey = `${card.calendarId || ''}::${card.uid || ''}::${dayKey}`;
        const seriesKey = `${card.calendarId || ''}::${card.uid || ''}`;

        if (scope === 'all' && card.uid) {
            if (!this.plugin.settings.hiddenRemoteEvents.includes(seriesKey)) {
                this.plugin.settings.hiddenRemoteEvents.push(seriesKey);
            }
            new obsidian.Notice(`Série de eventos "${card.cleanTitle || card.title}" ocultada`);
        } else {
            if (!this.plugin.settings.hiddenRemoteEvents.includes(instanceKey)) {
                this.plugin.settings.hiddenRemoteEvents.push(instanceKey);
            }
            if (card.id && !this.plugin.settings.hiddenRemoteEvents.includes(card.id)) {
                this.plugin.settings.hiddenRemoteEvents.push(card.id);
            }
            new obsidian.Notice(`Evento "${card.cleanTitle || card.title}" (${dayKey}) ocultado`);
        }

        await this.plugin.saveSettings();
        this.render();
    }

    async unhideAllRemoteEvents() {
        this.plugin.settings.hiddenRemoteEvents = [];
        await this.plugin.saveSettings();
        new obsidian.Notice('Todos os eventos do Google Agenda foram reexibidos!');
        this.render();
    }

    computeTimeblockLayout(timedCards, day) {
        if (!timedCards || timedCards.length === 0) return new Map();

        const items = timedCards.map(card => {
            const dt = getTimeForDay(card, day);
            const startMin = timeToMinutes(dt.timeStart);
            const endMin = timeToMinutes(dt.timeEnd || dt.timeStart);
            const dur = Math.max(15, endMin - startMin);
            return {
                card,
                startMin,
                endMin: startMin + dur,
                colIndex: 0,
                totalCols: 1,
            };
        });

        // Sort chronologically (earlier start first; longer duration first if same start)
        items.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

        // Group overlapping items into cluster collision groups
        const clusters = [];
        let curCluster = [];
        let clusterEnd = -1;

        for (const item of items) {
            if (curCluster.length === 0) {
                curCluster.push(item);
                clusterEnd = item.endMin;
            } else if (item.startMin < clusterEnd) {
                curCluster.push(item);
                clusterEnd = Math.max(clusterEnd, item.endMin);
            } else {
                clusters.push(curCluster);
                curCluster = [item];
                clusterEnd = item.endMin;
            }
        }
        if (curCluster.length > 0) clusters.push(curCluster);

        // Assign columns in each cluster
        const layoutMap = new Map();
        for (const cluster of clusters) {
            const columns = []; // array of endMin for each column
            for (const item of cluster) {
                let placed = false;
                for (let col = 0; col < columns.length; col++) {
                    if (columns[col] <= item.startMin) {
                        columns[col] = item.endMin;
                        item.colIndex = col;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    item.colIndex = columns.length;
                    columns.push(item.endMin);
                }
            }
            const totalCols = columns.length;
            for (const item of cluster) {
                item.totalCols = totalCols;
                layoutMap.set(item.card.id || item.card.uid || item.card.lineIndex, { colIndex: item.colIndex, totalCols });
            }
        }

        return layoutMap;
    }

    onSlotClick(h, m, dayCards, day) {
        const untimed = dayCards.filter(c => !getTimeForDay(c, day));
        new QuickCreateTaskModal(
            this.app,
            this.plugin,
            day,
            h,
            m,
            this.columns,
            untimed,
            async (title, column, startVal, endVal) => {
                await this.createNewTaskInTimeblock(title, column, day, startVal, endVal);
            },
            async (existingCard, startVal, endVal) => {
                await this.persistTimeBlock(existingCard, day, startVal, endVal);
                await this.refresh();
            }
        ).open();
    }

    async createNewTaskInTimeblock(title, column, day, startVal, endVal) {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.kanbanFile);
        if (!file) return;

        const dateTag = `@{${formatDate(day)}}`;
        const timeTag = `<!-- tb: ${startVal}-${endVal} -->`;
        const cardLineText = `${title} ${dateTag} ${timeTag}`;

        let content = await this.app.vault.read(file);
        content = this.parser.addCardToColumn(content, column, cardLineText);
        await this.app.vault.modify(file, content);
        new obsidian.Notice(`✓ Tarefa "${title}" criada em "${column}" (${startVal}–${endVal})`);
        await this.refresh();
    }

    renderTbCard(parent, card, day, dayStart, dayEnd, pxPerMin, layoutInfo) {
        const el = parent.createDiv('kt-tb-card');
        
        if (card.isRemoteCalendarEvent) {
            el.addClass('kt-tb-card-event');
            el.addClass('kt-tb-card-remote-event');
            el.style.setProperty('--proj-color', card.calendarColor || '#3b82f6');
            el.style.borderLeftColor = card.calendarColor || '#3b82f6';
        } else if (card.isEvent) {
            el.addClass('kt-tb-card-event');
            el.addClass(`kt-tb-card-${card.eventType || 'break'}`);
        } else {
            el.style.setProperty('--proj-color', card.tagColor || card.projectColor || 'transparent');
            if (card.priorityColor) el.style.setProperty('--prio-color', card.priorityColor);
        }

        const dayTime  = getTimeForDay(card, day);
        const startMin = timeToMinutes(dayTime.timeStart);
        const endMin   = timeToMinutes(dayTime.timeEnd || dayTime.timeStart);
        const duration = Math.max(15, endMin - startMin);

        // Posicionamento Vertical
        const topPx    = Math.max(0, (startMin - dayStart * 60) * pxPerMin);
        const heightPx = Math.max(26, duration * pxPerMin - 2);
        el.style.top    = `${topPx}px`;
        el.style.height = `${heightPx}px`;

        // Posicionamento Horizontal Anti-Sobreposição (Lado a Lado)
        const colIndex  = layoutInfo ? layoutInfo.colIndex : 0;
        const totalCols = layoutInfo ? layoutInfo.totalCols : 1;

        if (totalCols > 1) {
            const leftPct  = (colIndex / totalCols) * 100;
            const widthPct = (1 / totalCols) * 100;
            el.style.left  = `calc(${leftPct}% + 6px)`;
            el.style.width = `calc(${widthPct}% - 10px)`;
            el.style.right = 'auto';
            el.addClass('kt-tb-card-compact');
        } else {
            el.style.left  = '8px';
            el.style.right = '10px';
            el.style.width = 'auto';
        }

        const isDone = card.isCompleted || isIgnoredColumn(card.column);
        if (isDone) {
            el.addClass('is-completed');
            el.addClass('kt-tb-card-done');
        }

        // 1. Handle de Redimensionamento Superior (Apenas cards locais)
        if (!card.isRemoteCalendarEvent) {
            const topHandle = el.createDiv('kt-tb-resize-edge kt-tb-resize-top');
            topHandle.title = 'Arraste para ajustar horário inicial';
            this.attachTimeblockTopResize(topHandle, card, day, el, dayStart, dayEnd, pxPerMin);
        }

        // Conteúdo do Card
        const isRoutineOrEvent = card.isEvent || card.column === 'Rotina' || !!card.seriesId;

        const openEditModal = () => {
            if (card.isRemoteCalendarEvent) {
                new RemoteEventModal(this.app, card, async () => {
                    await this.hideRemoteEvent(card, 'single');
                }).open();
            } else if (isRoutineOrEvent) {
                new TimeBlockModal(
                    this.app,
                    card,
                    day,
                    parseInt(dayTime?.timeStart || '9'),
                    async (newTitle, ts, te, applyToAll) => {
                        await this.updateTimeEventSeries(card, day, newTitle, ts, te, applyToAll);
                    },
                    async (deleteAll) => {
                        await this.deleteTimeEventSeries(card, day, deleteAll);
                    }
                ).open();
            } else {
                this.openCardOptionsModal(card, day);
            }
        };

        const timeLabel = el.createDiv('kt-tb-card-time');
        timeLabel.setText(`⏰ ${dayTime.timeStart} – ${dayTime.timeEnd}`);
        timeLabel.title = card.isRemoteCalendarEvent ? 'Clique para ver detalhes do evento' : (isRoutineOrEvent ? 'Clique para editar este evento / série' : 'Clique para abrir e editar a tarefa');
        timeLabel.style.cursor = 'pointer';
        timeLabel.onclick = (e) => {
            e.stopPropagation();
            openEditModal();
        };

        const titleEl = el.createDiv('kt-c-title');
        titleEl.setText(card.isRemoteCalendarEvent ? `🗓️ ${card.title}` : (isDone ? `✓ ${card.title}` : card.title));
        titleEl.title = card.isRemoteCalendarEvent ? 'Clique para ver detalhes do evento' : (isRoutineOrEvent ? 'Clique para editar este evento / série' : 'Clique para abrir e editar a tarefa');
        titleEl.style.cursor = 'pointer';
        titleEl.onclick = (e) => {
            e.stopPropagation();
            openEditModal();
        };

        if (card.isRemoteCalendarEvent && card.calendarName) {
            const calSub = el.createDiv('kt-tb-card-cal-name');
            calSub.setText(card.calendarName);
        }

        const matchedProject = !card.isEvent && !card.isRemoteCalendarEvent ? getProjectForCard(card, this.plugin.settings.projects) : null;
        const hourlyRate = matchedProject ? (matchedProject.hourlyRate || 0) : 0;
        const currency = matchedProject ? (matchedProject.currency || 'R$') : 'R$';

        if (!card.isEvent && (card.tags?.length > 0 || hourlyRate > 0)) {
            const tagsRow = el.createDiv('kt-tags-row');
            if (card.tags && card.tags.length > 0) {
                card.tags.forEach(tag => {
                    const pill = tagsRow.createSpan('kt-tag-pill');
                    pill.setText(tag);
                    const key = tag.replace(/^#/, '').toLowerCase();
                    const col = getCardTagColor([tag], this.plugin.settings.projects) || PRIORITY_COLORS[key];
                    if (col) {
                        pill.style.color      = col;
                        pill.style.background = col + '22';
                    }
                });
            }

            if (hourlyRate > 0) {
                const earningsPill = tagsRow.createSpan('kt-tb-earnings-pill');
                const earningsAmount = (duration / 60) * hourlyRate;
                earningsPill.setText(`💵 ${formatCurrency(earningsAmount, currency)}`);
                earningsPill.title = `Ganho previsto: ${formatCurrency(earningsAmount, currency)} (${currency} ${hourlyRate}/h • ${duration}m)`;
                el.dataset.hourlyRate = String(hourlyRate);
                el.dataset.currency = currency;
            }
        }

        // Subtasks (Checklists - [ ] e - [x]) no corpo do Timeblocking
        if (card.subtasks && card.subtasks.length > 0) {
            const subtasksWrap = el.createDiv('kt-tb-subtasks-wrap');
            
            const completedCount = card.subtasks.filter(s => s.completed).length;
            const progress = subtasksWrap.createDiv('kt-tb-subtask-progress');
            progress.setText(`${completedCount}/${card.subtasks.length}`);

            const subtasksList = subtasksWrap.createDiv('kt-tb-subtask-items');
            card.subtasks.forEach(st => {
                const item = subtasksList.createDiv('kt-tb-subtask-item');
                const stChk = item.createSpan('kt-tb-subtask-chk');
                stChk.setText(st.completed ? '✓' : '○');
                stChk.title = st.completed ? 'Marcar como pendente' : 'Concluir subtarefa';
                stChk.onclick = async (e) => {
                    e.stopPropagation();
                    await this.toggleSubtaskCompletion(st.lineIndex);
                    await this.refresh();
                };

                const stText = item.createSpan('kt-tb-subtask-label');
                if (st.completed) stText.addClass('is-completed');
                renderFormattedTextWithLinks(stText, st.text, this.app, this.plugin.settings.kanbanFile);
            });
        }

        // 2. Handle de Redimensionamento Inferior & 3. Arraste do Bloco (Apenas cards locais)
        if (!card.isRemoteCalendarEvent) {
            const bottomHandle = el.createDiv('kt-tb-resize-edge kt-tb-resize-bottom');
            bottomHandle.title = 'Arraste para ajustar horário final';
            this.attachTimeblockBottomResize(bottomHandle, card, day, el, dayStart, dayEnd, pxPerMin);

            this.attachTimeblockCardMove(el, card, day, dayStart, dayEnd, pxPerMin);
        }

        // 4. Menu de Contexto (Botão Direito no Card)
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const menu = new obsidian.Menu();

            if (card.isRemoteCalendarEvent) {
                menu.addItem(item => {
                    item.setTitle('Ver detalhes do evento')
                        .setIcon('calendar')
                        .onClick(() => {
                            new RemoteEventModal(this.app, card, async () => {
                                await this.hideRemoteEvent(card, 'single');
                            }).open();
                        });
                });

                menu.addItem(item => {
                    item.setTitle('Ocultar este evento')
                        .setIcon('eye-off')
                        .onClick(async () => {
                            await this.hideRemoteEvent(card, 'single');
                        });
                });

                if (card.uid) {
                    menu.addItem(item => {
                        item.setTitle('Ocultar toda a série repetida')
                            .setIcon('calendar-off')
                            .onClick(async () => {
                                await this.hideRemoteEvent(card, 'all');
                            });
                    });
                }

                menu.showAtMouseEvent(e);
                return;
            }

            if (isRoutineOrEvent) {
                menu.addItem(item => {
                    item.setTitle('✏️ Editar evento / série')
                        .setIcon('pencil')
                        .onClick(() => openEditModal());
                });

                menu.addItem(item => {
                    item.setTitle('🗑️ Excluir apenas deste dia')
                        .setIcon('trash')
                        .setWarning()
                        .onClick(async () => {
                            await this.deleteTimeEventSeries(card, day, false);
                        });
                });

                menu.addItem(item => {
                    item.setTitle('🗑️ Excluir toda a série')
                        .setIcon('calendar-x')
                        .setWarning()
                        .onClick(() => {
                            new ConfirmDeleteModal(this.app, `toda a série "${card.title}"`, async () => {
                                await this.deleteTimeEventSeries(card, day, true);
                            }).open();
                        });
                });
            } else {
                menu.addItem(item => {
                    item.setTitle('Editar horário')
                        .setIcon('pencil')
                        .onClick(() => {
                            new TimeBlockModal(this.app, card, day, parseInt(dayTime?.timeStart || '9'), async (newTitle, ts, te) => {
                                await this.persistTimeBlock(card, day, ts, te);
                                await this.refresh();
                            }).open();
                        });
                });

                menu.addItem(item => {
                    item.setTitle('Excluir card')
                        .setIcon('trash')
                        .setWarning()
                        .onClick(async () => {
                            new ConfirmDeleteModal(this.app, card.title, async () => {
                                await this.deleteCardLine(card.lineIndex);
                                await this.refresh();
                            }).open();
                        });
                });
            }

            menu.showAtMouseEvent(e);
        });
    }

    attachTimeblockTopResize(handleEl, card, day, cardEl, dayStart, dayEnd, pxPerMin) {
        handleEl.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const dayTime      = getTimeForDay(card, day);
            const origStartMin = timeToMinutes(dayTime?.timeStart || '09:00');
            const origEndMin   = timeToMinutes(dayTime?.timeEnd || '10:00');
            const startY       = e.clientY;
            let previewStartMin = origStartMin;
            let hasMoved        = false;

            document.body.classList.add('kt-is-tb-resizing');
            const timeLabel = cardEl.querySelector('.kt-tb-card-time');

            const onPointerMove = (moveEvt) => {
                hasMoved = true;
                const deltaY = moveEvt.clientY - startY;
                const deltaMin = Math.round((deltaY / pxPerMin) / 15) * 15; // Snap de 15 min

                previewStartMin = Math.min(origEndMin - 15, Math.max(dayStart * 60, origStartMin + deltaMin));

                const newTop = (previewStartMin - dayStart * 60) * pxPerMin;
                const newHeight = Math.max(26, (origEndMin - previewStartMin) * pxPerMin - 2);

                cardEl.style.top    = `${newTop}px`;
                cardEl.style.height = `${newHeight}px`;

                if (timeLabel) {
                    timeLabel.setText(`⏰ ${minutesToTime(previewStartMin)} – ${minutesToTime(origEndMin)}`);
                }

                if (cardEl.dataset.hourlyRate) {
                    const earningsPill = cardEl.querySelector('.kt-tb-earnings-pill');
                    if (earningsPill) {
                        const rate = parseFloat(cardEl.dataset.hourlyRate) || 0;
                        const curr = cardEl.dataset.currency || 'R$';
                        const previewDur = Math.max(0, origEndMin - previewStartMin);
                        const amount = (previewDur / 60) * rate;
                        earningsPill.setText(`💵 ${formatCurrency(amount, curr)}`);
                        earningsPill.title = `Ganho previsto: ${formatCurrency(amount, curr)} (${curr} ${rate}/h • ${previewDur}m)`;
                    }
                }
            };

            const onPointerUp = async () => {
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.body.classList.remove('kt-is-tb-resizing');

                if (hasMoved && previewStartMin !== origStartMin) {
                    const ts = minutesToTime(previewStartMin);
                    const te = minutesToTime(origEndMin);
                    await this.persistTimeBlock(card, day, ts, te);
                    await this.refresh();
                }
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });
    }

    attachTimeblockBottomResize(handleEl, card, day, cardEl, dayStart, dayEnd, pxPerMin) {
        handleEl.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const dayTime      = getTimeForDay(card, day);
            const origStartMin = timeToMinutes(dayTime?.timeStart || '09:00');
            const origEndMin   = timeToMinutes(dayTime?.timeEnd || '10:00');
            const startY       = e.clientY;
            let previewEndMin   = origEndMin;
            let hasMoved        = false;

            document.body.classList.add('kt-is-tb-resizing');
            const timeLabel = cardEl.querySelector('.kt-tb-card-time');

            const onPointerMove = (moveEvt) => {
                hasMoved = true;
                const deltaY = moveEvt.clientY - startY;
                const deltaMin = Math.round((deltaY / pxPerMin) / 15) * 15; // Snap de 15 min

                previewEndMin = Math.max(origStartMin + 15, Math.min((dayEnd + 1) * 60, origEndMin + deltaMin));

                const newHeight = Math.max(26, (previewEndMin - origStartMin) * pxPerMin - 2);
                cardEl.style.height = `${newHeight}px`;

                if (timeLabel) {
                    timeLabel.setText(`⏰ ${minutesToTime(origStartMin)} – ${minutesToTime(previewEndMin)}`);
                }

                if (cardEl.dataset.hourlyRate) {
                    const earningsPill = cardEl.querySelector('.kt-tb-earnings-pill');
                    if (earningsPill) {
                        const rate = parseFloat(cardEl.dataset.hourlyRate) || 0;
                        const curr = cardEl.dataset.currency || 'R$';
                        const previewDur = Math.max(0, previewEndMin - origStartMin);
                        const amount = (previewDur / 60) * rate;
                        earningsPill.setText(`💵 ${formatCurrency(amount, curr)}`);
                        earningsPill.title = `Ganho previsto: ${formatCurrency(amount, curr)} (${curr} ${rate}/h • ${previewDur}m)`;
                    }
                }
            };

            const onPointerUp = async () => {
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.body.classList.remove('kt-is-tb-resizing');

                if (hasMoved && previewEndMin !== origEndMin) {
                    const ts = minutesToTime(origStartMin);
                    const te = minutesToTime(previewEndMin);
                    await this.persistTimeBlock(card, day, ts, te);
                    await this.refresh();
                }
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });
    }

    attachTimeblockCardMove(cardEl, card, day, dayStart, dayEnd, pxPerMin) {
        cardEl.addEventListener('pointerdown', (e) => {
            if (e.target.classList.contains('kt-tb-resize-edge')) return;
            if (e.target.closest('.kt-tb-card-time') || e.target.closest('.kt-tb-subtask-chk') || e.target.closest('.kt-tag-pill') || e.target.closest('a')) return;

            const dayTime      = getTimeForDay(card, day);
            const origStartMin = timeToMinutes(dayTime?.timeStart || '09:00');
            const origEndMin   = timeToMinutes(dayTime?.timeEnd || '10:00');
            const duration     = origEndMin - origStartMin;
            const startY       = e.clientY;
            let previewStartMin = origStartMin;
            let previewEndMin   = origEndMin;
            let hasMoved        = false;

            const timeLabel = cardEl.querySelector('.kt-tb-card-time');

            const onPointerMove = (moveEvt) => {
                const deltaY = moveEvt.clientY - startY;
                if (Math.abs(deltaY) > 3) {
                    hasMoved = true;
                    document.body.classList.add('kt-is-tb-resizing');
                    cardEl.classList.add('kt-dragging');

                    const deltaMin = Math.round((deltaY / pxPerMin) / 15) * 15; // Snap de 15 min
                    previewStartMin = Math.max(dayStart * 60, Math.min((dayEnd + 1) * 60 - duration, origStartMin + deltaMin));
                    previewEndMin   = previewStartMin + duration;

                    const newTop = (previewStartMin - dayStart * 60) * pxPerMin;
                    cardEl.style.top = `${newTop}px`;

                    if (timeLabel) {
                        timeLabel.setText(`⏰ ${minutesToTime(previewStartMin)} – ${minutesToTime(previewEndMin)}`);
                    }
                }
            };

            const onPointerUp = async () => {
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.body.classList.remove('kt-is-tb-resizing');
                cardEl.classList.remove('kt-dragging');

                if (hasMoved && previewStartMin !== origStartMin) {
                    const ts = minutesToTime(previewStartMin);
                    const te = minutesToTime(previewEndMin);
                    await this.persistTimeBlock(card, day, ts, te);
                    await this.refresh();
                } else if (!hasMoved) {
                    new TimeBlockModal(this.app, card, day, parseInt(dayTime?.timeStart || '9'), async (ts, te) => {
                        await this.persistTimeBlock(card, day, ts, te);
                        await this.refresh();
                    }).open();
                }
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });
    }

    // ----------------------------------------------------------
    // SHARED HELPERS
    // ----------------------------------------------------------

    renderTagPills(parent, tags, small = false) {
        if (!tags || tags.length === 0) return;
        const row = parent.createDiv('kt-tags-row');
        tags.forEach(tag => {
            const pill = row.createSpan(small ? 'kt-tag-pill kt-tag-small' : 'kt-tag-pill');
            pill.setText(tag);
            const key = tag.replace(/^#/, '').toLowerCase();
            const col = getCardTagColor([tag], this.plugin.settings.projects) || PRIORITY_COLORS[key];
            if (col) {
                pill.style.color      = col;
                pill.style.background = col + '22';
            }
        });
    }

    getWeekStart() {
        const now  = new Date();
        now.setHours(0, 0, 0, 0);
        const dow  = now.getDay();
        const diff = dow === 0 ? -6 : 1 - dow; // Monday
        const ws   = new Date(now);
        ws.setDate(ws.getDate() + diff + this.weekOffset * 7);
        return ws;
    }

    dayLabel(date, includeName = true) {
        const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const dd   = String(date.getDate()).padStart(2, '0');
        const mm   = String(date.getMonth() + 1).padStart(2, '0');
        return includeName
            ? `${days[date.getDay()]} ${dd}/${mm}`
            : `${dd}/${mm}/${date.getFullYear()}`;
    }

    dayLabelFull(date) {
        const daysFull = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        return `${daysFull[date.getDay()]}, ${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`;
    }
}

// ================================================================
// PLUGIN ENTRY POINT
// ================================================================

const DEFAULT_SETTINGS = {
    kanbanFile:            'Kanban.md',
    dayStart:              7,
    dayEnd:                22,
    backlogHeight:         280,
    backlogCollapsed:      false,
    ganttDaysMode:         '14',
    autoMoveTodayToInDev:  false,
    collapsedColumns:      [],
    hiddenColumns:         [],
    projects: [
        { id: 'proj-1', name: 'Projeto Principal', tag: '#Projeto', columns: ['Backlog'], color: '#6366f1', targetHours: 0, hourlyRate: 0, currency: 'R$' },
    ],
    habits: [
        { id: 'h-1', name: 'Exercício Físico', icon: '🏃', type: 'boolean', target: 1,  unit: 'vez',   color: '#ef4444', activeDays: [1, 2, 3, 4, 5] },
        { id: 'h-2', name: 'Leitura / Estudo', icon: '📖', type: 'time',    target: 30, unit: 'min',   color: '#3b82f6', activeDays: [0, 1, 2, 3, 4, 5, 6] },
        { id: 'h-3', name: 'Beber Água',       icon: '💧', type: 'count',   target: 8,  unit: 'copos', color: '#06b6d4', activeDays: [0, 1, 2, 3, 4, 5, 6] },
    ],
    habitLogs: {},
    postIts: [
        { id: 'pi-1', text: '💡 Ideias & Brainstorming:\n- Arraste post-its da bandeja inferior\n- Dê duplo clique no mural para criar notas', color: 'yellow', x: 70, y: 60, rotation: -2, zIndex: 1 },
        { id: 'pi-2', text: '📌 Lembretes:\n- Mova os blocos livremente pelo quadro\n- Fixe com o alfinete para travar a posição', color: 'pink', x: 320, y: 75, rotation: 1.5, zIndex: 2 },
    ],
    columnColors: {
        'Backlog':          '#06b6d4',
        'InDevelopment':    '#ec4899',
        'Done':             '#22c55e',
        'Archive':          '#64748b',
        'Rotina':           '#8b5cf6',
    },
    remoteCalendars: [],
    hiddenRemoteEvents: [],
    cronogramaSubView: 'gantt',
    timeblockSubView: 'day',
    timeblockHideWeekends: false,
    remoteCalendarAutoSyncMinutes: 15,
    awConnected: false,
    awHost: 'http://127.0.0.1:5600',
    dockLayout: null,
    finances: {
        currency: 'R$',
        selectedYear: new Date().getFullYear(),
        selectedMonth: new Date().getMonth() + 1,
        categories: [
            'Moradia',
            'Alimentação',
            'Gatas',
            'Saúde',
            'Transporte',
            'Serviços',
            'Lazer',
            'Compras',
            'Viagem',
            'Streamings',
            'Outros'
        ],
        incomeCategories: [
            'Pagamento',
            'Poupança',
            'Bônus',
            'Juros',
            'Outros'
        ],
        months: {}
    }
};

class KanbanTimelinePlugin extends obsidian.Plugin {
    async onload() {
        console.log('[Kanban Timeline] ▶ Loading...');

        this.settings = Object.assign({}, DEFAULT_SETTINGS);
        await this.loadSettings();

        this.remoteEventsCache = [];
        this.lastRemoteSync = 0;

        this.registerView(VIEW_TYPE, (leaf) => new KanbanTimelineView(leaf, this));

        this.addRibbonIcon('calendar-days', 'Abrir Kanban Timeline', () => this.activateView());

        this.addCommand({
            id:       'open-kanban-timeline',
            name:     'Abrir Cronograma / Timeblocking',
            callback: () => this.activateView(),
        });

        this.addCommand({
            id:       'sync-remote-calendars',
            name:     'Sincronizar Calendários Remotos (Google Agenda / iCal)',
            callback: async () => {
                const count = await this.syncAllRemoteCalendars(true);
                new obsidian.Notice(`✓ Sincronização concluída: ${count} eventos encontrados.`);
            },
        });

        this.addSettingTab(new KanbanTimelineSettingsTab(this.app, this));

        // Initial background sync
        this.syncAllRemoteCalendars(false);

        // Periodic sync every 15 minutes
        this.registerInterval(
            window.setInterval(() => {
                this.syncAllRemoteCalendars(false);
            }, 15 * 60 * 1000)
        );
    }

    async syncAllRemoteCalendars(force = false) {
        if (!this.settings.remoteCalendars || this.settings.remoteCalendars.length === 0) {
            this.remoteEventsCache = [];
            return 0;
        }

        const allEvents = [];
        for (const cal of this.settings.remoteCalendars) {
            if (cal.enabled === false || !cal.url) continue;
            try {
                let cleanUrl = cal.url.trim();
                if (cleanUrl.startsWith('webcal://')) cleanUrl = 'https://' + cleanUrl.slice(9);
                const res = await obsidian.requestUrl({ url: cleanUrl });
                if (res && res.text) {
                    const parsed = ICalParser.parse(res.text, cal);
                    allEvents.push(...parsed);
                }
            } catch (err) {
                console.warn(`[Kanban Timeline] Erro ao sincronizar calendário "${cal.name}":`, err);
            }
        }

        this.remoteEventsCache = allEvents;
        this.lastRemoteSync = Date.now();

        // Refresh any active timeline views
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        leaves.forEach(leaf => {
            if (leaf.view && typeof leaf.view.render === 'function') {
                leaf.view.render();
            }
        });

        return allEvents.length;
    }

    async loadSettings() {
        const saved = await this.loadData();
        if (saved) Object.assign(this.settings, saved);
        if (!this.settings.projects || this.settings.projects.length === 0) {
            this.settings.projects = DEFAULT_SETTINGS.projects.slice();
        }
        if (!this.settings.habits || this.settings.habits.length === 0) {
            this.settings.habits = DEFAULT_SETTINGS.habits.slice();
        }
        if (!this.settings.habitLogs) {
            this.settings.habitLogs = {};
        }
        if (!this.settings.postIts || this.settings.postIts.length === 0) {
            this.settings.postIts = DEFAULT_SETTINGS.postIts.slice();
        }
        if (!this.settings.remoteCalendars) {
            this.settings.remoteCalendars = [];
        }
        if (!this.settings.hiddenRemoteEvents) {
            this.settings.hiddenRemoteEvents = [];
        }
        if (!this.settings.cronogramaSubView) {
            this.settings.cronogramaSubView = 'gantt';
        }
        if (!this.settings.timeblockSubView) {
            this.settings.timeblockSubView = 'day';
        }
        if (this.settings.timeblockHideWeekends === undefined) {
            this.settings.timeblockHideWeekends = false;
        }
        if (!this.settings.finances) {
            this.settings.finances = Object.assign({}, DEFAULT_SETTINGS.finances);
        }
        if (!this.settings.finances.months) {
            this.settings.finances.months = {};
        }
        if (!this.settings.finances.categories || this.settings.finances.categories.length === 0) {
            this.settings.finances.categories = DEFAULT_SETTINGS.finances.categories.slice();
        }
        if (!this.settings.finances.incomeCategories || this.settings.finances.incomeCategories.length === 0) {
            this.settings.finances.incomeCategories = DEFAULT_SETTINGS.finances.incomeCategories.slice();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
            workspace.setActiveLeaf(leaf, { focus: true });
            if (leaf.view && typeof leaf.view.refresh === 'function') {
                await leaf.view.refresh();
            }
        }
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE);
        console.log('[Kanban Timeline] ■ Unloaded.');
    }
}

module.exports = KanbanTimelinePlugin;
