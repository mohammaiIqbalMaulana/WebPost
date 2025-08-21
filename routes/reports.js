var express = require('express');
var router = express.Router();
const db = require('../config/db');
const { formatDate } = require('../utils/dateHelper');

// 📌 LIST semua reports
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM reports ORDER BY id DESC");
    res.render('reports/index', {
      reports: rows,
      formatDate,
      title: "Daftar Reports",
      updated: req.query.updated || 0,
      errors: req.query.errors || 0
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 📌 FORM tambah report
router.get('/add', (req, res) => {
  res.render('reports/add', {
    title: 'Tambah Laporan'
  });
});

// 📌 ACTION tambah report
router.post('/add', async (req, res) => {
  let { platform, judul, post_url, like_count, comment_count, view_count, share_count, save_count, follower_count, post_date } = req.body;

  // Cek apakah judul sudah ada
  const [existing] = await db.query("SELECT judul FROM reports WHERE judul LIKE ?", [judul + '%']);

  if (existing.length > 0) {
    let counter = 1;
    let newJudul = judul + counter;

    const judulSet = new Set(existing.map(r => r.judul));
    while (judulSet.has(newJudul)) {
      counter++;
      newJudul = judul + counter;
    }
    judul = newJudul;
  }

  await db.query(
    `INSERT INTO reports 
    (platform, judul, post_url, like_count, comment_count, view_count, share_count, save_count, follower_count, post_date, report_date) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
    [platform, judul, post_url, like_count, comment_count, view_count, share_count, save_count, follower_count, post_date]
  );

  res.redirect('/reports');
});

// 📌 UPDATE: hanya laporan < 30 hari (UPDATED untuk field kosong)
router.get('/update', async (req, res) => {
  try {
    const today = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(today.getDate() - 30);

    const [reports] = await db.query(
      `SELECT id, judul, post_url, post_date 
       FROM reports 
       WHERE post_date >= ? 
       ORDER BY post_date DESC`,
      [cutoffDate.toISOString().split('T')[0]]
    );

    // PERUBAHAN: Tidak menampilkan nilai lama, biarkan kosong untuk user input
    const emptyReports = reports.map(r => ({
      id: r.id,
      judul: r.judul,
      post_url: r.post_url,
      post_date: r.post_date
      // Semua count field tidak disertakan, biarkan kosong
    }));

    res.render('reports/update', {
      reports: emptyReports,
      title: "Update Reports (≤ 30 Hari)"
    });
  } catch (err) {
    console.error("Error GET /update:", err);
    res.status(500).send(err.message);
  }
});

// 📌 POST UPDATE - Updated untuk handle required fields validation
router.post('/update', async (req, res) => {
  try {
    // Parse form arrays
    const ids = Array.isArray(req.body['ids[]']) ? req.body['ids[]'] : [req.body['ids[]']];
    const like_count = Array.isArray(req.body['like_count[]']) ? req.body['like_count[]'] : [req.body['like_count[]']];
    const comment_count = Array.isArray(req.body['comment_count[]']) ? req.body['comment_count[]'] : [req.body['comment_count[]']];
    const view_count = Array.isArray(req.body['view_count[]']) ? req.body['view_count[]'] : [req.body['view_count[]']];
    const share_count = Array.isArray(req.body['share_count[]']) ? req.body['share_count[]'] : [req.body['share_count[]']];
    const save_count = Array.isArray(req.body['save_count[]']) ? req.body['save_count[]'] : [req.body['save_count[]']];
    const follower_count = Array.isArray(req.body['follower_count[]']) ? req.body['follower_count[]'] : [req.body['follower_count[]']];

    // Validasi data
    if (!ids || ids.length === 0 || ids[0] === undefined) {
      return res.status(400).send("Tidak ada data dikirim");
    }

    // Validasi semua field required
    const requiredFields = [like_count, comment_count, view_count, share_count, save_count, follower_count];
    for (let i = 0; i < ids.length; i++) {
      const fieldValues = [
        like_count[i],
        comment_count[i],
        view_count[i],
        share_count[i],
        save_count[i],
        follower_count[i]
      ];
      
      // Validasi semua field harus diisi
      for (let j = 0; j < fieldValues.length; j++) {
        if (!fieldValues[j] || fieldValues[j] === '' || parseInt(fieldValues[j]) < 0) {
          return res.status(400).send(`Field ${['like_count', 'comment_count', 'view_count', 'share_count', 'save_count', 'follower_count'][j]} untuk ID ${ids[i]} tidak valid atau kosong`);
        }
      }
    }

    let updatedCount = 0;
    let errors = [];

    // Update setiap record
    for (let i = 0; i < ids.length; i++) {
      try {
        const id = parseInt(ids[i]);
        const like = parseInt(like_count[i]);
        const comment = parseInt(comment_count[i]);
        const view = parseInt(view_count[i]);
        const share = parseInt(share_count[i]);
        const save = parseInt(save_count[i]);
        const follower = parseInt(follower_count[i]);

        // Validasi ID
        if (!id || id <= 0) {
          errors.push(`ID tidak valid: ${ids[i]}`);
          continue;
        }

        // Validasi nilai tidak boleh negatif
        if (like < 0 || comment < 0 || view < 0 || share < 0 || save < 0 || follower < 0) {
          errors.push(`Nilai negatif terdeteksi untuk ID ${id}`);
          continue;
        }

        // Update database
        const [result] = await db.query(
          `UPDATE reports 
           SET like_count = ?, comment_count = ?, view_count = ?, share_count = ?, save_count = ?, follower_count = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [like, comment, view, share, save, follower, id]
        );

        if (result.affectedRows > 0) {
          updatedCount++;
        } else {
          errors.push(`Tidak ada perubahan untuk ID ${id}`);
        }
      } catch (updateError) {
        errors.push(`Error untuk ID ${ids[i]}: ${updateError.message}`);
      }
    }

    res.redirect(`/reports?updated=${updatedCount}&errors=${errors.length}`);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).send("Error: " + err.message);
  }
});

// 📌 ACTION delete report
router.get('/delete/:id', async (req, res) => {
  try {
    await db.query("DELETE FROM reports WHERE id = ?", [req.params.id]);
    res.redirect('/reports');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;