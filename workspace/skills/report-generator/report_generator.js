const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('node:fs/promises');
const path = require('node:path');

// ─── Color Palette ────────────────────────────────────────────────────────────
const C = {
    PRIMARY:       rgb(0.13, 0.38, 0.68),   // #2161AD deep blue
    PRIMARY_LIGHT: rgb(0.88, 0.93, 0.98),   // light blue card fill
    ACCENT:        rgb(0.18, 0.56, 0.34),   // green — positive change
    DANGER:        rgb(0.78, 0.20, 0.20),   // red — negative change
    AMBER:         rgb(0.88, 0.63, 0.12),   // amber / warning
    BLACK:         rgb(0.10, 0.10, 0.10),
    DARK:          rgb(0.22, 0.22, 0.22),
    MID:           rgb(0.50, 0.50, 0.50),
    LIGHT:         rgb(0.88, 0.88, 0.88),
    SUBTLE:        rgb(0.96, 0.96, 0.96),
    WHITE:         rgb(1, 1, 1),
    CHART: [
        rgb(0.13, 0.38, 0.68),  // blue
        rgb(0.18, 0.56, 0.34),  // green
        rgb(0.88, 0.63, 0.12),  // amber
        rgb(0.78, 0.20, 0.20),  // red
        rgb(0.55, 0.28, 0.67),  // purple
        rgb(0.95, 0.48, 0.14),  // orange
        rgb(0.16, 0.62, 0.62),  // teal
        rgb(0.62, 0.16, 0.50),  // magenta
    ],
};

// ─── Layout ───────────────────────────────────────────────────────────────────
const PW = 612, PH = 792;               // US Letter
const ML = 50, MR = 562, MT = 742, MB = 60;
const CW = MR - ML;                      // 512 content width

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtNum(n, prefix = '', suffix = '') {
    const abs = Math.abs(n);
    let s;
    if (abs >= 1_000_000)  s = (n / 1_000_000).toFixed(1) + 'M';
    else if (abs >= 10_000) s = (n / 1_000).toFixed(1) + 'K';
    else s = Number(n).toLocaleString('en-US');
    return `${prefix}${s}${suffix}`;
}

function wrapText(text, font, size, maxWidth) {
    const paragraphs = String(text).split('\n');
    const allLines = [];
    for (const para of paragraphs) {
        if (!para.trim()) { allLines.push(''); continue; }
        const words = para.split(' ');
        let current = '';
        for (const word of words) {
            const test = current ? `${current} ${word}` : word;
            if (font.widthOfTextAtSize(test, size) > maxWidth) {
                if (current) allLines.push(current);
                current = word;
            } else {
                current = test;
            }
        }
        if (current) allLines.push(current);
    }
    return allLines;
}

// ─── Report Builder ───────────────────────────────────────────────────────────
async function generateReport(data) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    let page, y, pageNum = 0;
    const allPages = [];

    function newPage() {
        page = doc.addPage([PW, PH]);
        pageNum++;
        y = MT;
        allPages.push(page);
    }

    function ensureSpace(needed) {
        if (y - needed < MB) newPage();
    }

    function drawRight(text, x, yy, f, size, color) {
        page.drawText(text, {
            x: x - f.widthOfTextAtSize(text, size), y: yy, font: f, size, color,
        });
    }

    // ─── First Page ───────────────────────────────────────────────────────────
    newPage();

    // Top accent bar
    page.drawRectangle({ x: ML, y: y - 2, width: CW, height: 5, color: C.PRIMARY });
    y -= 38;

    // Title
    const titleLines = wrapText(data.title || 'Report', bold, 24, CW);
    for (const line of titleLines) {
        page.drawText(line, { x: ML, y, font: bold, size: 24, color: C.BLACK });
        y -= 28;
    }

    // Subtitle
    if (data.subtitle) {
        page.drawText(data.subtitle, { x: ML, y, font, size: 13, color: C.MID });
        y -= 20;
    }

    // Author & Date
    y -= 4;
    const meta = [];
    if (data.author) meta.push(`Author: ${data.author}`);
    if (data.date)   meta.push(`Date: ${data.date}`);
    if (meta.length) {
        page.drawText(meta.join('    |    '), { x: ML, y, font, size: 9, color: C.MID });
        y -= 14;
    }

    // Separator
    page.drawRectangle({ x: ML, y, width: CW, height: 0.75, color: C.LIGHT });
    y -= 28;

    // ─── Section Renderers ────────────────────────────────────────────────────

    function renderSectionTitle(title) {
        ensureSpace(30);
        // Accent marker
        page.drawRectangle({ x: ML, y: y - 3, width: 3, height: 14, color: C.PRIMARY });
        page.drawText(title, { x: ML + 10, y, font: bold, size: 13, color: C.DARK });
        y -= 22;
    }

    // ── KPI Cards ─────────────────────────────────────────────────────────────
    function renderKPI(section) {
        if (section.title) { ensureSpace(110); renderSectionTitle(section.title); }
        else ensureSpace(85);

        const items = section.items || [];
        const count = Math.min(items.length, 4);
        if (!count) return;
        const gap = 12;
        const cardW = (CW - gap * (count - 1)) / count;
        const cardH = 68;

        for (let i = 0; i < count; i++) {
            const item = items[i];
            const cx = ML + i * (cardW + gap);

            // Card bg
            page.drawRectangle({ x: cx, y: y - cardH + 10, width: cardW, height: cardH, color: C.PRIMARY_LIGHT });
            // Left accent strip
            page.drawRectangle({ x: cx, y: y - cardH + 10, width: 4, height: cardH, color: C.PRIMARY });

            // Value
            page.drawText(String(item.value ?? ''), { x: cx + 14, y: y - 10, font: bold, size: 18, color: C.BLACK });
            // Label
            page.drawText(String(item.label ?? ''), { x: cx + 14, y: y - 30, font, size: 9, color: C.MID });

            // Change indicator (colored dot + text — avoids non-WinAnsi glyphs)
            if (item.change) {
                const str = String(item.change);
                const isPos = str.startsWith('+');
                const isNeg = str.startsWith('-');
                const col = isPos ? C.ACCENT : isNeg ? C.DANGER : C.MID;
                // Small colored indicator square
                page.drawRectangle({ x: cx + 14, y: y - 45, width: 6, height: 6, color: col });
                page.drawText(str, { x: cx + 24, y: y - 46, font: bold, size: 9, color: col });
            }
        }
        y -= cardH + 20;
    }

    // ── Table ─────────────────────────────────────────────────────────────────
    function renderTable(section) {
        const columns  = section.columns || [];
        const rows     = section.rows || [];
        const totalRow = section.total_row;
        const colCount = columns.length;
        if (!colCount) return;

        const headerH = 28, rowH = 24;
        const needed = headerH + rowH * Math.min(rows.length, 3) + 20;
        if (section.title) { ensureSpace(needed + 26); renderSectionTitle(section.title); }
        else ensureSpace(needed);

        // Column positions — support custom relative widths
        const relWidths = section.column_widths && section.column_widths.length === colCount
            ? section.column_widths
            : columns.map((_, i) => (i === 0 && colCount > 2 ? 2 : 1));
        const wTotal = relWidths.reduce((a, b) => a + b, 0);
        const absWidths = relWidths.map(w => (w / wTotal) * CW);
        const colX = absWidths.reduce((acc, w, i) => { acc.push(i ? acc[i - 1] + absWidths[i - 1] : ML); return acc; }, []);

        function drawTableHeader() {
            page.drawRectangle({ x: ML, y: y - 7, width: CW, height: headerH, color: C.PRIMARY });
            for (let i = 0; i < colCount; i++) {
                page.drawText(columns[i], { x: colX[i] + 8, y, font: bold, size: 9, color: C.WHITE });
            }
            y -= headerH + 4;
        }

        drawTableHeader();
        let rowIdx = 0;

        for (const row of rows) {
            const prevPage = pageNum;
            ensureSpace(rowH + 10);
            if (pageNum !== prevPage) drawTableHeader(); // re-draw header on new page

            if (rowIdx % 2 === 0) {
                page.drawRectangle({ x: ML, y: y - 6, width: CW, height: rowH, color: C.SUBTLE });
            }
            for (let i = 0; i < Math.min(row.length, colCount); i++) {
                page.drawText(String(row[i]), { x: colX[i] + 8, y, font, size: 9, color: C.BLACK });
            }
            y -= rowH;
            rowIdx++;
        }

        if (totalRow) {
            const prevPage = pageNum;
            ensureSpace(rowH + 10);
            if (pageNum !== prevPage) drawTableHeader();

            page.drawRectangle({ x: ML, y: y - 6, width: CW, height: rowH, color: C.LIGHT });
            for (let i = 0; i < Math.min(totalRow.length, colCount); i++) {
                page.drawText(String(totalRow[i]), { x: colX[i] + 8, y, font: bold, size: 9, color: C.BLACK });
            }
            y -= rowH;
        }
        y -= 16;
    }

    // ── Vertical Bar Chart ────────────────────────────────────────────────────
    function renderBarChart(section) {
        const labels = section.labels || [];
        const values = section.values || [];
        const prefix = section.prefix || '';
        const suffix = section.suffix || '';
        const count  = labels.length;
        if (!count) return;

        const chartH = 160, labelH = 30, totalH = chartH + labelH + 10;
        if (section.title) { ensureSpace(totalH + 30); renderSectionTitle(section.title); }
        else ensureSpace(totalH);

        const maxVal     = Math.max(...values, 1);
        const chartLeft  = ML + 50;
        const chartRight = MR - 10;
        const chartW     = chartRight - chartLeft;
        const chartTop   = y;
        const chartBot   = y - chartH;

        // Y-axis grid lines + labels
        for (let t = 0; t <= 4; t++) {
            const ty = chartBot + (chartH * t) / 4;
            const tv = Math.round((maxVal * t) / 4);
            page.drawRectangle({ x: chartLeft, y: ty, width: chartW, height: 0.5, color: C.LIGHT });
            drawRight(fmtNum(tv, prefix, suffix), chartLeft - 6, ty - 3, font, 7, C.MID);
        }

        // Bars
        const barGap = 8;
        const barW   = Math.min((chartW - barGap * (count + 1)) / count, 56);
        const barsW  = count * barW + (count - 1) * barGap;
        const startX = chartLeft + (chartW - barsW) / 2;

        for (let i = 0; i < count; i++) {
            const bx   = startX + i * (barW + barGap);
            const barH = Math.max((values[i] / maxVal) * (chartH - 14), 2);
            const col  = C.CHART[i % C.CHART.length];

            page.drawRectangle({ x: bx, y: chartBot + 1, width: barW, height: barH, color: col });

            // Value on top
            const vt = fmtNum(values[i], prefix, suffix);
            const vw = bold.widthOfTextAtSize(vt, 7);
            page.drawText(vt, { x: bx + (barW - vw) / 2, y: chartBot + barH + 4, font: bold, size: 7, color: C.DARK });

            // Label below
            const lw = font.widthOfTextAtSize(labels[i], 8);
            page.drawText(labels[i], { x: bx + (barW - lw) / 2, y: chartBot - 14, font, size: 8, color: C.MID });
        }

        // X-axis
        page.drawRectangle({ x: chartLeft, y: chartBot, width: chartW, height: 1, color: C.LIGHT });
        y = chartBot - labelH;
    }

    // ── Horizontal Bar Chart ──────────────────────────────────────────────────
    function renderHorizontalBar(section) {
        const labels = section.labels || [];
        const values = section.values || [];
        const prefix = section.prefix || '';
        const suffix = section.suffix || '';
        const count  = labels.length;
        if (!count) return;

        const barH = 22, gap = 6;
        const totalH = count * (barH + gap) + 10;
        if (section.title) { ensureSpace(totalH + 30); renderSectionTitle(section.title); }
        else ensureSpace(totalH);

        const maxVal    = Math.max(...values, 1);
        const labelW    = 110;
        const barLeft   = ML + labelW;
        const barMaxW   = CW - labelW - 60;

        for (let i = 0; i < count; i++) {
            const by  = y - i * (barH + gap);
            const bw  = Math.max((values[i] / maxVal) * barMaxW, 4);
            const col = C.CHART[i % C.CHART.length];

            // Label
            drawRight(labels[i], barLeft - 8, by + 5, font, 9, C.DARK);
            // Track bg
            page.drawRectangle({ x: barLeft, y: by, width: barMaxW, height: barH, color: C.SUBTLE });
            // Bar fill
            page.drawRectangle({ x: barLeft, y: by, width: bw, height: barH, color: col });
            // Value
            const vt = fmtNum(values[i], prefix, suffix);
            page.drawText(vt, { x: barLeft + bw + 6, y: by + 6, font: bold, size: 8, color: C.DARK });
        }
        y -= totalH + 8;
    }

    // ── Progress Bars ─────────────────────────────────────────────────────────
    function renderProgress(section) {
        const items = section.items || [];
        if (!items.length) return;
        const barH = 14, rowH = 38;

        if (section.title) { ensureSpace(rowH + 30); renderSectionTitle(section.title); }
        else ensureSpace(rowH);

        for (const item of items) {
            ensureSpace(rowH + 5);
            const pct = Math.min(Math.max(item.value || 0, 0), 100);

            // Label + percentage
            page.drawText(item.label || '', { x: ML, y, font, size: 9, color: C.DARK });
            drawRight(`${pct}%`, MR, y, bold, 9, C.DARK);
            y -= 14;

            // Track
            page.drawRectangle({ x: ML, y: y - 2, width: CW, height: barH, color: C.LIGHT });
            // Fill
            const col = item.color === 'green' ? C.ACCENT
                      : item.color === 'red'   ? C.DANGER
                      : item.color === 'amber' ? C.AMBER
                      : C.PRIMARY;
            page.drawRectangle({ x: ML, y: y - 2, width: CW * (pct / 100), height: barH, color: col });
            y -= barH + 10;
        }
        y -= 8;
    }

    // ── Text / Paragraphs ─────────────────────────────────────────────────────
    function renderText(section) {
        if (section.title) { ensureSpace(40); renderSectionTitle(section.title); }
        const lines = wrapText(section.content || '', font, 10, CW);
        const lineH = 16;

        for (const line of lines) {
            ensureSpace(lineH + 5);
            if (line === '') { y -= 8; continue; }
            page.drawText(line, { x: ML, y, font, size: 10, color: C.DARK });
            y -= lineH;
        }
        y -= 10;
    }

    // ── Divider ───────────────────────────────────────────────────────────────
    function renderDivider() {
        ensureSpace(20);
        y -= 6;
        page.drawRectangle({ x: ML, y, width: CW, height: 0.75, color: C.LIGHT });
        y -= 14;
    }

    // ── Spacer ────────────────────────────────────────────────────────────────
    function renderSpacer(section) {
        y -= (section.height || 20);
        if (y < MB) newPage();
    }

    // ─── Render All Sections ──────────────────────────────────────────────────
    const renderers = {
        kpi:            renderKPI,
        table:          renderTable,
        bar_chart:      renderBarChart,
        horizontal_bar: renderHorizontalBar,
        progress:       renderProgress,
        text:           renderText,
        divider:        renderDivider,
        spacer:         renderSpacer,
    };

    for (const section of (data.sections || [])) {
        const fn = renderers[section.type];
        if (fn) fn(section);
        else console.error(`[report-generator] Unknown section type: ${section.type}`);
    }

    // ─── Page Footers ─────────────────────────────────────────────────────────
    const genDate = new Date().toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    for (let i = 0; i < allPages.length; i++) {
        const p = allPages[i];
        p.drawRectangle({ x: ML, y: MB - 18, width: CW, height: 0.5, color: C.LIGHT });

        const pgText = `Page ${i + 1} of ${allPages.length}`;
        p.drawText(pgText, {
            x: MR - font.widthOfTextAtSize(pgText, 7), y: MB - 30, font, size: 7, color: C.MID,
        });
        p.drawText(`Generated: ${genDate}`, { x: ML, y: MB - 30, font, size: 7, color: C.MID });
    }

    // ─── Save ─────────────────────────────────────────────────────────────────
    const pdfBytes = await doc.save();
    const resultsDir = '/tmp';

    const slug = (data.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    const fileName = `${slug}_${Date.now()}.pdf`;
    const filePath = path.join(resultsDir, fileName);
    await fs.writeFile(filePath, pdfBytes);

    return { filePath, title: data.title, pageCount: allPages.length };
}

// ─── CLI Entry ────────────────────────────────────────────────────────────────
(async () => {
    const args = process.argv.slice(2);
    const p = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) p[args[i].slice(2)] = args[++i];
    }

    let data;
    if (p.data_file) {
        data = JSON.parse(await fs.readFile(p.data_file, 'utf-8'));
    } else if (p.data) {
        data = JSON.parse(p.data);
    } else {
        console.error('Error: Provide --data_file <path> or --data <json>');
        process.exit(1);
    }

    // CLI overrides
    if (p.title)    data.title    = p.title;
    if (p.subtitle) data.subtitle = p.subtitle;
    if (p.author)   data.author   = p.author;
    if (p.date)     data.date     = p.date;

    const result = await generateReport(data);
    console.log(`${data.title || 'Report'} — ${result.pageCount} page(s)`);
    console.log(`FILE_PATH:${result.filePath}`);
})().catch(err => {
    console.error(`Error generating report: ${err.message}`);
    process.exit(1);
});
