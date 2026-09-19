-- =============================================================================
-- Asesmen Go/No-Go · 03 · Data awal
-- Jalankan SETELAH 02. Aman dijalankan ulang: baris yang sudah ada TIDAK ditimpa,
-- jadi perubahan admin lewat tab Kelola tetap utuh.
--
-- Sumber:
--   * Operator: EVA_ANTAMxPCM_DS_030926.xlsx, sheet operator_DS (203 akun)
--   * Pengawas: PLAN_POLA_KERJA_DINAMIS_2026_SEPTEMBER_NEW.xlsx, sheet Pengawas Dev & Prod
--     (18 akun). PIN awal = NPP; pengawas bisa menggantinya sendiri, admin bisa mengatur ulang.
--   * Unit: sheet master_unit_population di EVA (119 unit)
--   * Lokasi: TOS / LOCATION di sheet EQ_Assignment EVA + stasiun peta RTUP
-- Tidak diimpor: 7895 NIRWAN ASKARI (tercantum di Pengawas Planning, bukan operator)
-- =============================================================================

-- Admin modul (akun Supabase)
insert into public.gng_admin (email, ditambah_oleh) values ('rahmat.iqbal@antam.com','data awal'), ('dani.suryawan@antam.com','data awal') on conflict do nothing;

-- Pertanyaan F-09.283.020.R0
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (1, 'A', 1, 'Saya sehat, cukup tidur, dan tidak mengantuk. Fit declaration sudah saya isi.', 'Kondisi fisik operator, fit declaration', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (2, 'A', 2, 'Saya punya SIMPER untuk alat ini dan masih berlaku.', 'SIMPER sesuai alat dan berlaku', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (3, 'A', 3, 'Saya sudah ikut safety talk atau staging plan, dan tahu lokasi serta target kerja hari ini.', 'Ikut staging plan, tahu lokasi dan target', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (4, 'A', 4, 'APD saya lengkap: helm, sepatu safety, rompi, kacamata, masker, ear plug.', 'APD lengkap', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (5, 'A', 5, 'Saya tahu di mana titik kumpul evakuasi di area ini.', 'Tahu titik kumpul evakuasi', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (6, 'B', 6, 'P2H hari ini sudah saya isi dan sudah diperiksa pengawas.', 'P2H sudah diisi dan diperiksa', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (7, 'B', 7, 'Tidak ada kerusakan pada unit ini yang belum diperbaiki.', 'Tidak ada kerusakan belum diperbaiki', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (8, 'B', 8, 'Rem, klakson, lampu, dan rotary lamp saya coba dan semuanya berfungsi.', 'Rem, klakson, lampu, rotary lamp berfungsi', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (9, 'B', 9, 'Seatbelt terpasang dan radio komunikasi menyala di kanal yang benar.', 'Seatbelt dan radio komunikasi', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (10, 'C', 10, 'Safety berm atau tanggul pengaman sudah terpasang di tepi lokasi kerja dan tepi buang, tingginya minimal 3/4 tinggi ban alat angkut terbesar.', 'Safety berm minimal 3/4 tinggi ban', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (11, 'C', 11, 'Patok batas galian dari Mine Plan sudah terpasang, dan pengukuran Survey di lokasi ini sudah selesai.', 'Patok batas galian dan data Survey', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (12, 'C', 12, 'Loading point, jalur masuk dan keluar front, serta lokasi dumping sudah ditentukan pengawas.', 'Loading point, jalur front, lokasi dumping', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (13, 'C', 13, 'Bendera atau patok batas buang di lokasi penimbunan sudah terpasang dan terlihat jelas.', 'Bendera atau patok batas buang', array['ADT','Dump Truck','Bulldozer'], null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (14, 'C', 14, 'Landasan tempat kerja dan tempat buang padat, tidak lembek. Jalan front tidak bergelombang dan tidak licin.', 'Landasan padat, jalan front tidak rusak', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (15, 'D', 15, 'Status lereng hari ini NORMAL, bukan Waspada dan bukan Siaga.', 'Status lereng NORMAL', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (16, 'D', 16, 'Tidak ada retakan, gerakan, atau material menggantung di lereng dekat saya bekerja.', 'Tidak ada retakan atau material menggantung', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (17, 'D', 17, 'Tidak hujan deras dan jalan tidak licin.', 'Tidak hujan deras, jalan tidak licin', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (18, 'D', 18, 'Untuk shift malam, tower lamp menyala dan mengarah ke area kerja.', 'Tower lamp menyala (shift malam)', null, 2, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (19, 'D', 19, 'Debu terkendali, atau jalan sudah disiram water truck.', 'Debu terkendali atau jalan sudah disiram', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (20, 'E', 20, 'Jarak alat saya ke kaki atau dinding lereng minimal 1 kali tinggi bench. Tidak ada galian menggantung (undercut).', 'Jarak 1x tinggi bench, tidak undercut', array['Excavator','Bulldozer','Wheel Loader'], null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (21, 'E', 21, 'Sebelum mulai memuat, safety berm di loading point sudah dibuat lebih dulu.', 'Safety berm dibuat sebelum memuat', array['Excavator','Wheel Loader'], null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (22, 'E', 22, 'Radius putar (swing) excavator bebas dari orang dan alat lain.', 'Radius swing bebas orang dan alat', array['Excavator'], null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (23, 'E', 23, 'Sebelum mundur atau memuat, saya kontak dulu lewat radio atau klakson. Klakson 2 kali maju, 3 kali mundur.', 'Kontak positif dan isyarat klakson', null, null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (24, 'E', 24, 'Jarak dengan unit di depan minimal 50 meter. Saya tidak mendahului di tikungan atau tanjakan.', 'Jarak iring-iringan 50 m, tidak mendahului', array['ADT','Dump Truck','Water Truck','Fuel Truck','Manhaul','LV'], null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (25, 'E', 25, 'Muatan tidak melebihi bak, tidak ada boulder ikut, dan pintu bak terkunci.', 'Muatan, boulder, pintu bak', array['ADT','Dump Truck'], null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (26, 'E', 26, 'Tempat dumping datar, ada dumping man atau spotter, dan vessel saya turunkan sempurna sebelum jalan.', 'Dumping datar, spotter, vessel turun', array['ADT','Dump Truck'], null, 'data awal') on conflict (id) do nothing;
insert into public.gng_pertanyaan (id, bagian, urut, teks, ringkas, alat, shift, diubah_oleh) values (27, 'E', 27, 'Saat mengisi BBM, mesin dimatikan dan tidak ada api atau percikan di sekitar.', 'Pengisian BBM aman', null, null, 'data awal') on conflict (id) do nothing;

-- Pengawas (PIN awal = NPP)
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('8015', 'Teddy Djawa', 'pengawas', 'Spv Produksi', extensions.crypt('8015', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7973', 'Bahrin Haedar', 'pengawas', 'Spv Produksi', extensions.crypt('7973', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7636', 'Irwan Tjan', 'pengawas', 'Spv Produksi', extensions.crypt('7636', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7992', 'Men Pinge', 'pengawas', 'Officer Produksi', extensions.crypt('7992', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7972', 'Aziz Ahmad', 'pengawas', 'Officer Produksi', extensions.crypt('7972', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('8001', 'Sukardi', 'pengawas', 'Officer Produksi', extensions.crypt('8001', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7974', 'Bahtiar Wahid', 'pengawas', 'Officer Produksi', extensions.crypt('7974', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('8030', 'Jonatan Radja', 'pengawas', 'Officer Produksi', extensions.crypt('8030', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7984', 'Ismail Anwar', 'pengawas', 'Officer Produksi', extensions.crypt('7984', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7993', 'Mikanor Togo', 'pengawas', 'Officer Produksi', extensions.crypt('7993', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7981', 'Hendra Lingko', 'pengawas', 'Officer Produksi', extensions.crypt('7981', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7887', 'Marselinus Untung', 'pengawas', 'Officer Produksi', extensions.crypt('7887', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7816', 'Musa Hi Medo', 'pengawas', 'Officer Produksi', extensions.crypt('7816', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('8036', 'Silfon Kiy', 'pengawas', 'Officer Produksi', extensions.crypt('8036', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7644', 'Ronaldo Wassaleruay', 'pengawas', 'Spv Minedev', extensions.crypt('7644', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7809', 'Enrico Tatepa', 'pengawas', 'Spv Minedev', extensions.crypt('7809', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('8082', 'Donal Wararag', 'pengawas', 'Officer MPD', extensions.crypt('8082', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;
insert into public.gng_akun (npp, nama, peran, jabatan, pin_hash, pin_awal, sumber, diubah_oleh) values ('7836', 'Iwan Saleh', 'pengawas', 'Officer MPD', extensions.crypt('7836', extensions.gen_salt('bf')), true, 'pola-kerja', 'data awal') on conflict (npp) do nothing;

-- Operator
insert into public.gng_akun (npp, nama, peran, jabatan, alat_bawaan, sumber, diubah_oleh) values
  ('AW0011', 'Abdul Wahab Nursalim', 'operator', 'Operator BUS', 'Manhaul', 'eva', 'data awal'),
  ('8027', 'Abdullah A. Djafar', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('AD001', 'Abuhafas Djafar', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('APK003', 'Adam Putra Kiana', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('AY0009', 'Ahmad Yudi', 'operator', 'Operator BUS', 'Manhaul', 'eva', 'data awal'),
  ('8730', 'Alfian Rizcky Arisandy R.Gani', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('9252', 'Alfikram Abdullah', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('9326', 'Ali Hamzah', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('AA001', 'Andhika Afriyanto', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('9263', 'Anwar', 'operator', 'Driver Manhaul', 'Manhaul', 'eva', 'data awal'),
  ('9381', 'Aren Limor', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('9255', 'Arfan A. Rauf', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('AP0002', 'Arif Pakaya', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('9420', 'Aris Risal', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('AK001', 'Ariyanto Kifli', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('8084', 'Asriel Veplun', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('AL002', 'Aswin Latawan', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('9390', 'Ayub Adam', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('9389', 'Ayunangsi Tomodi', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('BN001', 'Barik Najim', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('7870', 'Baso Syamsuddin', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('9332', 'Budiman Hasan Kayani', 'operator', 'Driver Manhaul', 'Manhaul', 'eva', 'data awal'),
  ('BU0001', 'Budiman Umalekhoa', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('7977', 'Daniel Salakparang', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('8008', 'Danyel Barbakem', 'operator', 'Operator 6 - Water Truck Operator', 'Water Truck', 'eva', 'data awal'),
  ('9331', 'Darmin Ismail', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('DE0012', 'Didik Efendi', 'operator', 'Operator BUS', 'Manhaul', 'eva', 'data awal'),
  ('DK0005', 'Djakmal Karim', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('7978', 'Dominggus Barbakem', 'operator', 'Operator 4 - Motor Grader', 'Grader', 'eva', 'data awal'),
  ('DA0010', 'Dwi Agus S', 'operator', 'Operator BUS', 'Manhaul', 'eva', 'data awal'),
  ('9385', 'Fahdi Hasan', 'operator', 'Operator 4 - Dump Truck > 100T MPD', 'Dump Truck', 'eva', 'data awal'),
  ('FH0004', 'Fahmi Husen', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('9409', 'Faisal Usman', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9333', 'Fardila Ibrahim', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('8755', 'Farizal Syarif', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('8757', 'Fermento Guslaw', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('8083', 'Ferry Loleng', 'operator', 'Operator 6 - Water Truck Operator MPD', 'Water Truck', 'eva', 'data awal'),
  ('9383', 'Fiqri Ramadhan', 'operator', 'Operator 4 - Dump Truck > 100T MPD', 'Dump Truck', 'eva', 'data awal'),
  ('9023', 'Hardian Latawan', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9287', 'Hasan Hamisi', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('HL001', 'Haswan Latawan', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('8770', 'Hendra Pongparante', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('8382', 'Hendri', 'operator', null, null, 'eva', 'data awal'),
  ('IU001', 'Iskandar U. Ishak', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('9267', 'Jelmita Batawi', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9037', 'Julham Jainal', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9351', 'Kadek Sugiariasih', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('RA001', 'M Rizal Arifin', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('9338', 'Mardika Kamakai', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('8037', 'Marsius Guslaw', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('9272', 'Melinda Hingide', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9350', 'Miftahur Rozak', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9344', 'Muhammad Achmad', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('8997', 'Muhdar Samma', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9382', 'Muhlis Kasman', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('ML0006', 'Mursalim Latawan', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('9310', 'Musa Patanduk', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9396', 'Novita Masoara', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9395', 'Nunung Jumaini Ibrahim', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9393', 'Nurdin Mumen', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('8012', 'Orais Labortus Bulango', 'operator', 'Operator 6 - Water Truck Operator MPD', 'Water Truck', 'eva', 'data awal'),
  ('9246', 'Rais Abdullah', 'operator', 'Operator 4 - Motor Grader MPD', 'Grader', 'eva', 'data awal'),
  ('9325', 'Ramli Sultan', 'operator', 'Driver Manhaul', 'Manhaul', 'eva', 'data awal'),
  ('9328', 'Rifando Lasero', 'operator', 'Operator 4 - Dump Truck > 100T MPD', 'Dump Truck', 'eva', 'data awal'),
  ('9384', 'Rinaldi Abbas', 'operator', 'Operator 4 - Dump Truck > 100T MPD', 'Dump Truck', 'eva', 'data awal'),
  ('RA002', 'Risdianto Amran', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('RB001', 'Riski Bahar', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('9392', 'Rizky Almin Pawane', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9341', 'Rusli Sangadji', 'operator', 'Operator 4 - Motor Grader MPD', 'Grader', 'eva', 'data awal'),
  ('9391', 'Saharia Mamole', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('SS001', 'Sahlan', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('9286', 'Saleh Kahar', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('9271', 'Sawi Pinge', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('SJ0008', 'Sikin Hi Jainuddin', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('9273', 'Simson Julianus Alo''O', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9394', 'Siti Nikma Yahya', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('6349', 'Steven Roi Tonapa', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('SA0007', 'Suhardi Ansar', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('9402', 'Suherdi Jawali', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('9410', 'Tonny Aleksandro Soares', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('UM001', 'Umar M', 'operator', 'Operator 4 - Dump Truck > 100T (6x4 Cap 24M3,SANY)', 'Dump Truck', 'eva', 'data awal'),
  ('7811', 'Veri Rande', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9281', 'Vianita Maryon Tayawi', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9000', 'Yansen Sarimamu', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('9408', 'Yayan Stenly Hohakay', 'operator', 'Operator 4 - Dump Truck > 100T MPD', 'Dump Truck', 'eva', 'data awal'),
  ('8033', 'Yohanson Molle', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9014', 'Yusran Yanto', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('7913', 'Yusuf Kala Allo', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('8024', 'Yusup Salim', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('9254', 'Zulkifli S.M. Saleh', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9100', 'Panji Ptp', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9101', 'Robert Ptp', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9102', 'Daniel Ptp', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9103', 'Wahyu Ptp', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9104', 'Biring Ptp', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9105', 'Rou Ptp', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('9944', 'Sandy Zakaria', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('9945', 'Abdu Maulur', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('95000133', 'Shanneta Lukman', 'operator', 'Operator 4 - Dump Truck > 100T (ADT, VOLVO, A40E)', 'ADT', 'eva', 'data awal'),
  ('24075', 'Budiman', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('17022', 'Lamusa', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('24068', 'Fajri Syaifuddin', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('24011', 'Yumelda Akelamo', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('25031', 'M. Rifaldi', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('25015', 'Jefri Barakati', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('25039', 'Ali Iksan', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('25014', 'Ali Imran', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('25019', 'Namsar Yunus', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('20009', 'Iswandi Aswad', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('25029', 'Al Imron Limau', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('24040', 'Sarman Kamis', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('24050', 'Hi Rusli Hi Haedar', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('18050', 'Samsudin Sofyan', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('22088', 'Safrin Ngolo', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('25040', 'Brahman Bahrun N', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('24036', 'Risnawati Effendy', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('19005', 'Bakri Hi Sahabuddin', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('22080', 'Bahri Din', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('18023', 'Bambang Permadi', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('17012', 'Samsul Pakar', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('18029', 'Nasir', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('20018', 'Hasrani Umalekoa', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('24055', 'Stevan Lesomar', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('17023', 'Marten Bawang', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('23129', 'Jainal Yusuf', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('23104', 'Ses Harnisto Hadi', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('24069', 'Yogi Abas', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('18044', 'Rahmulyadi', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('22063', 'Asep Hidayat', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('24064', 'Dandi Aidin', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('23114', 'Al Idrus Abd. Hamit', 'operator', 'Operator 2 - Excavator >200T MPD', 'Excavator', 'eva', 'data awal'),
  ('24038', 'Yusran Hasan', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('24004', 'Wahyudi Yunus', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25018', 'Jems Supembri R', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('24042', 'Fredy Fence T', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25007', 'Irwan', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25026', 'Aldi', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('24028', 'Maxi Pangkerego', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25032', 'Riki Irawan O.B', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25023', 'Ali Kamari', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25030', 'Afendi', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('24071', 'Rusdi', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25008', 'Yusup Fabanyo', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25017', 'Maryanto Badri', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25006', 'Rusdy', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('24003', 'Hatta Senen', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('24002', 'Hasanuddin', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('23128', 'Mandar Hasan', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('23130', 'Moh. Fitri Alimun', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25004', 'Mutahir Mahmud', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25016', 'Irwan Amin', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('23102', 'Arifin Napu', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('17008', 'Sulhan', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('25002', 'Hamsah', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('23126', 'Hasanudin Kader', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('19019', 'Ahsani Said', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('20037', 'Anang', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('18034', 'Usman Meta', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('19014', 'Yusup Handayani', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('20039', 'Jamaludin', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('20033', 'Muhrin Tiabo', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('20047', 'Amiruddin', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('21063', 'Ade Puad Hasan', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('21061', 'Yakobus August Dumanauw', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('20046', 'Marboby', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('20052', 'Nasaruddin', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('22066', 'M. Aris', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('22086', 'Kader Daim', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('18021', 'Budi Haryanto', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('19021', 'Djabir S.Domo', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('23123', 'Basri', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('17003', 'Darman Samsudin', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('17006', 'Basuki', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('20044', 'Yahya Muhajir', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('17019', 'Hari Susanto', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('17007', 'Sodik Sujarwo', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('18045', 'Asep Subehi', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('22089', 'Harun Mogou', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('22093', 'Fahri Alifat', 'operator', 'Operator 4 - Motor Grader MPD', 'Grader', 'eva', 'data awal'),
  ('21065', 'Sigit Saputro', 'operator', 'Operator 4 - Motor Grader MPD', 'Grader', 'eva', 'data awal'),
  ('20049', 'Muhammad Bahar', 'operator', 'Operator 4 - Motor Grader MPD', 'Grader', 'eva', 'data awal'),
  ('18024', 'Lukman Pradana', 'operator', 'Operator 4 - Motor Grader MPD', 'Grader', 'eva', 'data awal'),
  ('22078', 'Alimudin Ali', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('17011', 'Sulaiman Dahlan', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('22090', 'Niek Rafane', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('18009', 'M. Irwan Karim', 'operator', 'Operator 4 - Dozer D7/D85/D8/D155', 'Bulldozer', 'eva', 'data awal'),
  ('21057', 'Muhammad Hasan', 'operator', 'Operator 6 - Water Truck Operator MPD', 'Water Truck', 'eva', 'data awal'),
  ('24054', 'Ismit Nyong', 'operator', 'Operator 6 - Water Truck Operator MPD', 'Water Truck', 'eva', 'data awal'),
  ('24059', 'Jamal Arafah', 'operator', 'Operator 6 - Water Truck Operator MPD', 'Water Truck', 'eva', 'data awal'),
  ('22087', 'Wahyu Aditya', 'operator', 'Operator 6 - Water Truck Operator MPD', 'Water Truck', 'eva', 'data awal'),
  ('18051', 'Fadli Daud Ali', 'operator', 'Operator 6 - Fuel Truck Operator MPD', 'Fuel Truck', 'eva', 'data awal'),
  ('18002', 'Abdullah Hendrik', 'operator', 'Operator 6 - Fuel Truck Operator MPD', 'Fuel Truck', 'eva', 'data awal'),
  ('17038', 'Sodikin', 'operator', 'Operator 6 - Fuel Truck Operator MPD', 'Fuel Truck', 'eva', 'data awal'),
  ('20022', 'Hasan Muhammad', 'operator', 'Operator 6 - Fuel Truck Operator MPD', 'Fuel Truck', 'eva', 'data awal'),
  ('24012', 'Edwin', 'operator', 'Operator 6 - Fuel Truck Operator MPD', 'Fuel Truck', 'eva', 'data awal'),
  ('26002', 'Rusdiyanto B', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('26003', 'Hairin M Jufri', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('26004', 'Firman', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('26005', 'Riski Tuduho', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('26006', 'Lukman', 'operator', 'Operator 4 - Dump Truck > 100T', 'Dump Truck', 'eva', 'data awal'),
  ('26007', 'Fachrul Zaini', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('8167', 'Jamal Lesang', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal'),
  ('8232', 'Ridha M.', 'operator', 'Operator 2 - Excavator >200T', 'Excavator', 'eva', 'data awal')
on conflict (npp) do nothing;

-- Unit
insert into public.gng_unit (nama, alat, model, sumber, diubah_oleh) values
  ('EX_9PS03', 'Excavator', 'EC330BLC', 'eva', 'data awal'),
  ('EX_9PS05', 'Excavator', 'EC460BLC', 'eva', 'data awal'),
  ('EX_9PS11', 'Excavator', 'EC460BLC', 'eva', 'data awal'),
  ('DT_9RD01', 'ADT', 'A40E', 'eva', 'data awal'),
  ('DT_9RD10', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DT_9RD11', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DT_9RD14', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DT_9RD15', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DT_9RD18', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DT_9RD21', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DT_9RD26', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DT_9RD28', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DT_9RD30', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DT_9RD33', 'ADT', 'A40F', 'eva', 'data awal'),
  ('DZ_9BD04', 'Bulldozer', 'D6R', 'eva', 'data awal'),
  ('DZ_9BD07', 'Bulldozer', 'D6R', 'eva', 'data awal'),
  ('DZ_9WL01', 'Wheel Loader', '416F', 'eva', 'data awal'),
  ('9MG01', 'Grader', '120K', 'eva', 'data awal'),
  ('EX_9PS13', 'Excavator', '303.5D', 'eva', 'data awal'),
  ('EX_9PS14', 'Excavator', '320D', 'eva', 'data awal'),
  ('EX_9PS17', 'Excavator', 'E45', 'eva', 'data awal'),
  ('EX_9PS19', 'Excavator', '320D-2', 'eva', 'data awal'),
  ('EX_9PS20', 'Excavator', '305.E2', 'eva', 'data awal'),
  ('EX_9PS21', 'Excavator', '305.E2', 'eva', 'data awal'),
  ('DT_9FT06', 'Fuel Truck', 'AXOR 2528C', 'eva', 'data awal'),
  ('9WT01', 'Water Truck', 'CWB', 'eva', 'data awal'),
  ('9WT02', 'Water Truck', 'CWB', 'eva', 'data awal'),
  ('DT_9DT01', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_9DT02', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_9DT03', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_9DT04', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('9HS02', 'Water Truck', 'HINO 300', 'eva', 'data awal'),
  ('MANHAUL 04', 'Manhaul', 'HINO 300', 'eva', 'data awal'),
  ('MANHAUL 05', 'Manhaul', 'HINO 300', 'eva', 'data awal'),
  ('9LV100', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV06', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV07', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV201', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV202', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV217', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV218', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV01', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV02', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV03', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV04', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV05', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV08', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('LV09', 'LV', 'HILUX KUN125R', 'eva', 'data awal'),
  ('EX_EXC02', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC03', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC05', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC09', 'Excavator', 'SK300', 'eva', 'data awal'),
  ('EX_EXC11', 'Excavator', 'SK300', 'eva', 'data awal'),
  ('EX_EXC15', 'Excavator', 'SK300', 'eva', 'data awal'),
  ('EX_EXC17', 'Excavator', 'SK300', 'eva', 'data awal'),
  ('EX_EXC18', 'Excavator', 'SK300', 'eva', 'data awal'),
  ('EX_EXC19', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC20', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC21', 'Excavator', 'SK300', 'eva', 'data awal'),
  ('EX_EXC22', 'Excavator', 'SK300', 'eva', 'data awal'),
  ('EX_EXC23', 'Excavator', 'SK300', 'eva', 'data awal'),
  ('EX_EXC24', 'Excavator', 'SK300', 'eva', 'data awal'),
  ('EX_EXC25', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC04', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC08', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC10', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('DT_DTH01', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH05', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH07', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH08', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH11', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH12', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH17', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH18', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH19', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH20', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH21', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH22', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH23', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH35', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH36', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH37', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH39', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH40', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTH41', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('DT_DTR24', 'Dump Truck', 'RENAULT', 'eva', 'data awal'),
  ('DT_DTR25', 'Dump Truck', 'RENAULT', 'eva', 'data awal'),
  ('DT_DTR26', 'Dump Truck', 'RENAULT', 'eva', 'data awal'),
  ('DT_DTR27', 'Dump Truck', 'RENAULT', 'eva', 'data awal'),
  ('DT_DTR28', 'Dump Truck', 'RENAULT', 'eva', 'data awal'),
  ('DT_DTR29', 'Dump Truck', 'RENAULT', 'eva', 'data awal'),
  ('DZ_BD01', 'Bulldozer', 'D6R', 'eva', 'data awal'),
  ('DZ_BD02', 'Bulldozer', 'D6R', 'eva', 'data awal'),
  ('DZ_BD03', 'Bulldozer', 'D6R', 'eva', 'data awal'),
  ('GD02', 'Grader', '120K', 'eva', 'data awal'),
  ('GD03', 'Grader', '120K', 'eva', 'data awal'),
  ('GD04', 'Grader', '120K', 'eva', 'data awal'),
  ('WT01', 'Water Truck', 'CWB', 'eva', 'data awal'),
  ('WT02', 'Water Truck', 'CWB', 'eva', 'data awal'),
  ('WT03', 'Water Truck', 'CWB', 'eva', 'data awal'),
  ('DT_FT01', 'Fuel Truck', 'AXOR 2528C', 'eva', 'data awal'),
  ('DT_FT02', 'Fuel Truck', 'AXOR 2528C', 'eva', 'data awal'),
  ('DT_DTH06', 'Dump Truck', 'FM 260 JD / HINO 500', 'eva', 'data awal'),
  ('EX_EXC26', 'Excavator', 'SK330', 'eva', 'data awal'),
  ('EX_EXC27', 'Excavator', 'SK520', 'eva', 'data awal'),
  ('EX_EXC28', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC29', 'Excavator', 'SK330', 'eva', 'data awal'),
  ('EX_EXC30', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC31', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('EX_EXC32', 'Excavator', 'SK360', 'eva', 'data awal'),
  ('DZ_BD04', 'Bulldozer', 'D6R', 'eva', 'data awal'),
  ('DZ_BD05', 'Bulldozer', 'D8R', 'eva', 'data awal'),
  ('DZ_BD06', 'Bulldozer', 'D6R', 'eva', 'data awal'),
  ('9MG05', 'Grader', '120K', 'eva', 'data awal'),
  ('EX_EXC09_SMR', 'Excavator', 'SK200', 'eva', 'data awal'),
  ('DT_DTV59', 'Dump Truck', 'VOLVO 460', 'eva', 'data awal'),
  ('DT_DTV60', 'Dump Truck', 'VOLVO 460', 'eva', 'data awal'),
  ('GD05', 'Grader', '120K', 'eva', 'data awal'),
  ('DT_FT03', 'Fuel Truck', 'AXOR 2528C', 'eva', 'data awal')
on conflict do nothing;

-- Lokasi
insert into public.gng_lokasi (nama, sumber, diubah_oleh) values
  ('AT 03', 'eva', 'data awal'),
  ('EFO', 'eva', 'data awal'),
  ('ETO BICOLI', 'eva', 'data awal'),
  ('ETO KASWARI', 'eva', 'data awal'),
  ('ETO SANGAJI', 'eva', 'data awal'),
  ('ETO WAYAMLI', 'eva', 'data awal'),
  ('FR MAFIA BARAT', 'eva', 'data awal'),
  ('FR MAFIA UTARA', 'eva', 'data awal'),
  ('JETTY', 'eva', 'data awal'),
  ('RAMPSTOCK BICOLI', 'eva', 'data awal'),
  ('RAMPSTOCK SUBAIM', 'eva', 'data awal'),
  ('TOMOHON', 'eva', 'data awal'),
  ('TOS 1', 'eva', 'data awal'),
  ('TOS 2', 'eva', 'data awal'),
  ('TOS 3', 'eva', 'data awal'),
  ('WD WAYAMLI', 'eva', 'data awal'),
  ('WS ANTAM 2', 'eva', 'data awal'),
  ('WS CASTELA', 'eva', 'data awal'),
  ('WS PCM', 'eva', 'data awal'),
  ('EFO · Jetty', 'rtup', 'data awal'),
  ('ETO Wato-Wato', 'rtup', 'data awal'),
  ('WD Para-Para', 'rtup', 'data awal'),
  ('ETO Harmoni', 'rtup', 'data awal'),
  ('ETO Kasuari', 'rtup', 'data awal'),
  ('WD Onat', 'rtup', 'data awal'),
  ('ETO Subaim Atas', 'rtup', 'data awal'),
  ('WD Sosolat', 'rtup', 'data awal'),
  ('WD Jara-Jara', 'rtup', 'data awal'),
  ('ETO Miaf', 'rtup', 'data awal'),
  ('WD Dorosago', 'rtup', 'data awal'),
  ('Front Mafia', 'rtup', 'data awal')
on conflict do nothing;

-- Stasiun dari peta RTUP bersama, bila sudah ada di tabel dashboard
do $$
begin
  if to_regclass('public.dashboard') is not null then
    insert into public.gng_lokasi (nama, sumber, diubah_oleh)
    select distinct trim(x ->> 'name'), 'rtup', 'data awal'
    from public.dashboard d, jsonb_array_elements(d.data -> 'payload' -> 'nodes') x
    where d.id = 'rtup|jaringan|v1' and coalesce(trim(x ->> 'name'), '') <> ''
    on conflict do nothing;
  end if;
end $$;

