# LSB Steganography App

## Deskripsi
Aplikasi web berbasis klien (client-side) untuk melakukan teknik Steganografi menggunakan metode Least Significant Bit (LSB). Aplikasi ini menyisipkan pesan rahasia (Secret Message) ke dalam sebuah gambar (Cover Image) tanpa mengubah tampilan visual gambar secara signifikan. Aplikasi ini juga dilengkapi dengan generator nomor pseudo-acak (PRNG) berbasis Stego-Key untuk menentukan posisi piksel secara acak, sehingga meningkatkan keamanan pesan yang disisipkan.

Fitur utama:
- **Embedding:** Menyisipkan pesan ke dalam gambar (PNG/BMP).
- **Extraction:** Mengekstrak kembali pesan rahasia dari Stego Image menggunakan Stego-Key yang sesuai.
- **Image Analysis:** Menghitung kualitas hasil penyisipan menggunakan metrik evaluasi MSE (Mean Squared Error) dan PSNR (Peak Signal-to-Noise Ratio).
- **JPEG Fragility Test:** Menguji ketahanan pesan yang disisipkan (Stego Image) terhadap kompresi format JPEG pada berbagai tingkat kualitas (Quality Factor).

## Cara Instalasi
Aplikasi ini sepenuhnya berjalan di sisi klien (browser) menggunakan HTML, CSS, dan Vanilla JavaScript. Tidak diperlukan instalasi *library* backend atau database.
1. *Clone* repositori ini ke komputer lokal Anda:
   ```bash
   git clone https://github.com/zkomunika/steganografi-kelompok13.git
   ```
2. Buka folder repositori yang telah diunduh:
   ```bash
   cd steganografi-kelompok13
   ```

## Cara Menjalankan
Karena aplikasi ini menggunakan ES Modules (`import`/`export` di JavaScript), aplikasi harus dijalankan menggunakan server HTTP lokal (tidak bisa sekadar klik dua kali file `index.html`).
1. Pastikan Anda telah menginstal [Node.js](https://nodejs.org/).
2. Jalankan perintah berikut di terminal pada direktori proyek:
   ```bash
   npx serve
   ```
3. Buka browser dan akses alamat URL yang tertera di terminal (biasanya `http://localhost:3000`).

## Contoh Penggunaan
### 1. Menyisipkan Pesan (Embedding)
- Buka menu **Embedding**.
- Tarik dan lepas (drag & drop) gambar yang akan dijadikan penampung (Cover Image) bertipe PNG atau BMP.
- Masukkan pesan rahasia pada kolom **Secret Message**.
- Masukkan kata sandi (Stego-Key) pada kolom **Stego-Key**.
- Klik tombol **Embed Message**.
- Anda dapat mengunduh gambar hasil (Stego Image) dengan menekan tombol **Download Stego Image**.

### 2. Mengekstrak Pesan (Extraction)
- Buka menu **Extraction**.
- Unggah file Stego Image yang sebelumnya telah disisipkan pesan.
- Masukkan Stego-Key yang sama seperti pada saat penyisipan.
- Klik **Extract Message**. Pesan rahasia Anda akan ditampilkan.

### 3. Menguji Kompresi (JPEG Fragility Test)
- Buka menu **JPEG Fragility Test**.
- Unggah Stego Image dan masukkan Stego-Key.
- Pilih *Quality Factor* atau gunakan opsi **Run All QF (100/90/70/50/30)**.
- Aplikasi akan menyimulasikan kompresi JPEG dan melaporkan *Bit Accuracy* dari pesan setelah gambar dikompresi.

## Anggota Kelompok 13
* Nabil Dhia Pratama - 247006111019
* M. Zaky Al Mubarok - 247006111041
* Hasbi Rabbani - 247006111045
