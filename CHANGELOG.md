# Changelog

## [Latest] - 2024-12-19

### Added
- ✨ Implementasi SweetAlert2 untuk pop-up notifications yang modern
- 🎨 Animasi CSS dengan Animate.css untuk transisi yang smooth
- 🚀 Pop-up konfirmasi delete dengan preview data
- ⚡ Loading state untuk proses delete
- 🎯 Auto-dismiss notifications dengan progress timer

### Fixed
- 🐛 Bug localhost redirect loop - tambah route root ke /reports
- 🔧 Notifikasi yang tidak mau menghilang otomatis
- ❌ Tombol X pada notifikasi yang tidak berfungsi

### Changed
- 🎨 Ubah semua styling menggunakan Bootstrap saja
- 🚫 Hilangkan tanda bintang (*) di header form update
- 📝 Form ADD: field boleh kosong, disimpan sebagai NULL
- ✅ Form UPDATE: tetap wajib diisi semua field
- 💾 Backend menangani field kosong dengan menyimpan sebagai NULL
- 📊 Tampilan data NULL ditampilkan sebagai '-' di tabel

### Improved
- 🎨 UI/UX dengan pop-up yang lebih modern dan interaktif
- 📱 Responsive design untuk semua pop-up
- ⚡ Performance dengan menghapus CSS custom yang tidak perlu
- 🎭 Visual feedback dengan berbagai jenis animasi