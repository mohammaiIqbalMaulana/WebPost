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

  // Function to process numeric fields - convert empty to NULL
  const processNumericField = (value) => {
    if (value === '' || value === undefined || value === null) return null;
    const num = parseInt(value);
    return isNaN(num) ? null : num;
  };

  const processedLike = processNumericField(like_count);
  const processedComment = processNumericField(comment_count);
  const processedView = processNumericField(view_count);
  const processedShare = processNumericField(share_count);
  const processedSave = processNumericField(save_count);
  const processedFollower = processNumericField(follower_count);

  await db.query(
    `INSERT INTO reports 
    (platform, judul, post_url, like_count, comment_count, view_count, share_count, save_count, follower_count, post_date, report_date) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
    [platform, judul, post_url, processedLike, processedComment, processedView, processedShare, processedSave, processedFollower, post_date]
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

    // Function to process numeric fields - convert empty to NULL, validate negative
    const processNumericField = (value) => {
      if (value === '' || value === undefined || value === null) return null;
      const num = parseInt(value);
      if (isNaN(num) || num < 0) return null;
      return num;
    };

    let updatedCount = 0;
    let errors = [];

    // Update setiap record
    for (let i = 0; i < ids.length; i++) {
      try {
        const id = parseInt(ids[i]);
        
        // Validasi ID
        if (!id || id <= 0) {
          errors.push(`ID tidak valid: ${ids[i]}`);
          continue;
        }

        // Process all numeric fields
        const like = processNumericField(like_count[i]);
        const comment = processNumericField(comment_count[i]);
        const view = processNumericField(view_count[i]);
        const share = processNumericField(share_count[i]);
        const save = processNumericField(save_count[i]);
        const follower = processNumericField(follower_count[i]);

        // Check if at least one field has a value (not all empty)
        const hasValue = [like, comment, view, share, save, follower].some(val => val !== null);
        
        if (!hasValue) {
          // Skip this record if all fields are empty
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