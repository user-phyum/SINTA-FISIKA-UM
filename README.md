# Robot Data SINTA — Departemen Fisika UM

Setiap hari pukul 02.17 WIB, GitHub Actions membuka 39 profil SINTA, membaca angka
terkininya, lalu menyimpan hasilnya ke `data/sinta-data.json`. Dashboard di WordPress
membaca file ini.

## Isi repositori
- `scripts/scrape-sinta.mjs` — robot pembaca SINTA (Playwright)
- `data/roster.json` — daftar dosen: Scholar ID, SINTA ID, nama (tambahkan di sini kalau ada dosen baru)
- `data/sinta-data.json` — hasil terbaru (diperbarui otomatis oleh robot)
- `.github/workflows/update-sinta.yml` — jadwal harian

## Pemasangan
1. Buat repositori **Public** baru, misalnya `sinta-fisika-um`.
2. Unggah semua isi folder ini, termasuk folder tersembunyi `.github`.
3. Buka Settings → Actions → General → Workflow permissions → pilih **Read and write permissions** → Save.
4. Buka tab Actions → "Update data SINTA" → **Run workflow**, lalu cek log-nya.
5. Buka `data/sinta-data.json` → klik **Raw** → salin URL-nya.
6. Di file dashboard, isi `const SINTA_JSON_URL = 'URL-RAW-TADI';` lalu unggah ulang ke WordPress.

## Menjalankan di komputer sendiri (kalau SINTA memblokir server GitHub)
    npm install
    npx playwright install chromium
    npm run scrape

## Status tiap dosen di sinta-data.json
- `ok` — berhasil dibaca pada run terakhir
- `stale` — gagal dibaca, angka dari run sebelumnya dipertahankan
- `seed` — masih data awal bawaan dashboard (robot belum pernah berhasil)
