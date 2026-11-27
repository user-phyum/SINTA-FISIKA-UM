// =====================================================================
// Robot pembaca data SINTA — Departemen Fisika UM
// Membuka setiap profil SINTA dengan browser headless (Playwright),
// membaca angka terkini, lalu menyimpannya ke data/sinta-data.json.
// Jika satu profil gagal dibaca, data lama untuk profil itu dipertahankan.
// =====================================================================
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROSTER_FILE = 'data/roster.json';
const OUTPUT_FILE = 'data/sinta-data.json';
const PROFILE_URL = (id) => `https://sinta.kemdiktisaintek.go.id/authors/profile/${id}`;
const DELAY_MS = 4000;       // jeda antar-profil agar tidak membebani server SINTA
const PAGE_TIMEOUT = 45000;  // batas waktu memuat satu halaman
const MAX_RETRY = 2;         // percobaan ulang per profil
const EARLY_ABORT = 3;       // berhenti jika N profil pertama semuanya gagal
const DEBUG_DIR = 'debug';   // screenshot & isi halaman saat gagal (untuk diagnosis)
const MAX_DEBUG = 3;

const METRIC_ROWS = {
    articles: 'Article',
    citations: 'Citation',
    citedDoc: 'Cited Document',
    hIndex: 'H-Index',
    i10: 'i10-Index',
    gIndex: 'G-Index'
};

const toInt = (s) => {
    const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
    return Number.isNaN(n) ? null : n;
};
const isNumberLine = (s) => /^[\d.,]+$/.test(s.trim());
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Cari angka SINTA Score: angka bisa di baris yang sama, di baris sebelum, atau sesudah label
function findScore(lines, label) {
    const labelRe = new RegExp(escapeRe(label), 'i');
    const i = lines.findIndex((l) => labelRe.test(l));
    if (i < 0) return null;
    const rest = lines[i].replace(labelRe, '').trim();
    if (isNumberLine(rest) && rest) return toInt(rest);
    if (i > 0 && isNumberLine(lines[i - 1])) return toInt(lines[i - 1]);
    if (i + 1 < lines.length && isNumberLine(lines[i + 1])) return toInt(lines[i + 1]);
    return null;
}

// Baca satu baris tabel metrik: "Article  416  1812  165" -> [Scopus, GScholar, WoS]
function findRow(text, label) {
    const re = new RegExp(`(?:^|\\n)\\s*${escapeRe(label)}\\s+([\\d.,]+)\\s+([\\d.,]+)\\s+([\\d.,]+)`, 'i');
    const m = text.match(re);
    return m ? [toInt(m[1]), toInt(m[2]), toInt(m[3])] : null;
}

export function parseProfileText(innerText) {
    const text = innerText.replace(/\r/g, '');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    const result = {
        sintaOverall: findScore(lines, 'SINTA Score Overall'),
        sinta3Yr: findScore(lines, 'SINTA Score 3Yr'),
        scopus: {}, gscholar: {}, wos: {}
    };

    let rowsFound = 0;
    for (const [key, label] of Object.entries(METRIC_ROWS)) {
        const row = findRow(text, label);
        if (!row) continue;
        rowsFound++;
        if (row[0] !== null) result.scopus[key] = row[0];
        if (row[1] !== null) result.gscholar[key] = row[1];
        if (row[2] !== null) result.wos[key] = row[2];
    }

    // Validasi: harus ada SINTA Score Overall + minimal baris Article & Citation
    const valid = result.sintaOverall !== null && rowsFound >= 2;
    return valid ? result : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function main() {
    const { chromium } = await import('playwright');
    const roster = await readJson(ROSTER_FILE, []);
    const previous = await readJson(OUTPUT_FILE, { researchers: {} });
    const out = { updatedAt: new Date().toISOString(), source: 'sinta.kemdiktisaintek.go.id', researchers: {} };

    const browser = await chromium.launch();
    const context = await browser.newContext({
        locale: 'id-ID',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
    });
    const page = await context.newPage();

    await fs.mkdir(DEBUG_DIR, { recursive: true });
    let ok = 0;
    let debugSaved = 0;
    for (const [idx, person] of roster.entries()) {
        const url = PROFILE_URL(person.sintaId);
        const prev = previous.researchers?.[person.scholarId] || {};
        let parsed = null;

        let lastText = '';
        let lastStatus = null;
        for (let attempt = 1; attempt <= MAX_RETRY && !parsed; attempt++) {
            try {
                const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
                lastStatus = resp ? resp.status() : null;
                await page.waitForSelector('text=SINTA Score Overall', { timeout: 15000 }).catch(() => {});
                lastText = await page.innerText('body').catch(() => '');
                parsed = parseProfileText(lastText);
            } catch (err) {
                lastText = `ERROR: ${err.message.split('\n')[0]}`;
                console.warn(`   percobaan ${attempt} gagal: ${err.message.split('\n')[0]}`);
            }
            if (!parsed && attempt < MAX_RETRY) await sleep(DELAY_MS);
        }

        if (!parsed) {
            // Catat apa yang sebenarnya tampil, untuk diagnosis
            const title = await page.title().catch(() => '');
            const snippet = lastText.replace(/\s+/g, ' ').trim().slice(0, 300);
            console.log(`   ↳ HTTP ${lastStatus} | judul: "${title}" | URL akhir: ${page.url()}`);
            console.log(`   ↳ cuplikan isi: ${snippet || '(kosong)'}`);
            if (debugSaved < MAX_DEBUG) {
                debugSaved++;
                const base = `${DEBUG_DIR}/gagal-${person.sintaId}`;
                await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
                await fs.writeFile(`${base}.html`, await page.content().catch(() => '')).catch(() => {});
                await fs.writeFile(`${base}.txt`, lastText).catch(() => {});
            }
        }

        const tag = `[${idx + 1}/${roster.length}] ${person.name || person.scholarId}`;
        if (parsed) {
            ok++;
            out.researchers[person.scholarId] = {
                sintaId: person.sintaId,
                url,
                sintaOverall: parsed.sintaOverall,
                sinta3Yr: parsed.sinta3Yr ?? prev.sinta3Yr ?? 0,
                scopus: { ...(prev.scopus || {}), ...parsed.scopus },
                gscholar: { ...(prev.gscholar || {}), ...parsed.gscholar },
                wos: { ...(prev.wos || {}), ...parsed.wos },
                status: 'ok',
                lastSynced: new Date().toISOString()
            };
            console.log(`✓ ${tag} — Overall ${parsed.sintaOverall}, 3Yr ${parsed.sinta3Yr}`);
        } else {
            // Pertahankan data lama, tandai sebagai "stale"
            out.researchers[person.scholarId] = {
                ...prev, sintaId: person.sintaId, url,
                status: prev.sintaOverall != null ? 'stale' : 'missing',
                lastAttempt: new Date().toISOString()
            };
            console.log(`• ${tag} — gagal dibaca, memakai data sebelumnya`);
        }
        if (idx + 1 === EARLY_ABORT && ok === 0) {
            console.error(`\n${EARLY_ABORT} profil pertama semuanya gagal — robot dihentikan lebih awal.`);
            console.error('Lihat folder "debug" pada bagian Artifacts untuk screenshot halaman SINTA.');
            break;
        }
        await sleep(DELAY_MS);
    }

    await browser.close();
    console.log(`\nSelesai: ${ok}/${roster.length} profil berhasil diperbarui.`);

    if (ok === 0) {
        console.error('Tidak ada profil yang berhasil dibaca — file data TIDAK diubah.');
        process.exit(1);
    }
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(out, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
