var express = require('express');
var router = express.Router();
const db = require('../config/db');
const { formatDate, formatDateTime } = require('../utils/dateHelper');

// 📌 LIST semua reports
router.get('/', async (req, res) => {
  try {
    // Pagination params
    const allowedPerPage = [5, 10, 50, 100];
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const perPageRaw = parseInt(req.query.perPage) || 10;
    const perPage = allowedPerPage.includes(perPageRaw) ? perPageRaw : 10;

    const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM reports");
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * perPage;

    const [rows] = await db.query(
      "SELECT *, updated_at FROM reports ORDER BY id DESC LIMIT ? OFFSET ?",
      [perPage, offset]
    );

    res.render('reports/index', {
      reports: rows,
      formatDate,
      formatDateTime,
      title: "Daftar Reports",
      updated: req.query.updated || 0,
      errors: req.query.errors || 0,
      pagination: {
        totalItems: total,
        totalPages,
        currentPage,
        perPage,
        allowedPerPage,
        offset
      }
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
  try {
    let { platform, judul, post_url, like_count, comment_count, view_count, share_count, save_count, follower_count, post_date } = req.body;

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

    res.redirect('/reports?created=1');
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.redirect('/reports/add?error=duplicate');
    }
    console.error('Error adding report:', err);
    return res.redirect('/reports/add?error=unknown');
  }
});

// 📌 UPDATE: hanya laporan yang di-post hari ini (same day update only)
router.get('/update', async (req, res) => {
  try {
    const today = new Date();
    const todayString = today.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Pagination params
    const allowedPerPage = [5, 10, 50, 100];
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const perPageRaw = parseInt(req.query.perPage) || 10;
    const perPage = allowedPerPage.includes(perPageRaw) ? perPageRaw : 10;

    // Count today's reports
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM reports WHERE DATE(post_date) = ?`,
      [todayString]
    );
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * perPage;

    // Get paginated reports posted today only
    const [todayReports] = await db.query(
      `SELECT id, judul, post_url, post_date 
       FROM reports 
       WHERE DATE(post_date) = ? 
       ORDER BY post_date DESC 
       LIMIT ? OFFSET ?`,
      [todayString, perPage, offset]
    );
    
    // Also get reports from last 30 days for reference (but not editable)
    const cutoffDate = new Date();
    cutoffDate.setDate(today.getDate() - 30);
    
    const [allReports] = await db.query(
      `SELECT id, judul, post_url, post_date 
       FROM reports 
       WHERE post_date >= ? 
       ORDER BY post_date DESC`,
      [cutoffDate.toISOString().split('T')[0]]
    );

    // PERUBAHAN: Hanya tampilkan laporan hari ini untuk update
    const emptyTodayReports = todayReports.map(r => ({
      id: r.id,
      judul: r.judul,
      post_url: r.post_url,
      post_date: r.post_date
      // Semua count field tidak disertakan, biarkan kosong
    }));

    res.render('reports/update', {
      reports: emptyTodayReports,
      allReportsCount: allReports.length,
      todayReportsCount: todayReports.length,
      title: "Update Reports (Hari Ini Saja)",
      pagination: {
        totalItems: total,
        totalPages,
        currentPage,
        perPage,
        allowedPerPage,
        offset
      }
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

// 📌 ANALYTICS: Engagement Rate & Target Setting
router.get('/analytics', async (req, res) => {
  try {
    // Pagination params
    const allowedPerPage = [5, 10, 50, 100];
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const perPageRaw = parseInt(req.query.perPage) || 10;
    const perPage = allowedPerPage.includes(perPageRaw) ? perPageRaw : 10;

    // Count with same filters
    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM reports 
      WHERE like_count IS NOT NULL 
        AND comment_count IS NOT NULL 
        AND view_count IS NOT NULL
        AND follower_count IS NOT NULL
        AND follower_count > 0
    `);
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * perPage;

    const [reports] = await db.query(`
      SELECT 
        id, 
        judul, 
        post_url, 
        like_count, 
        comment_count, 
        view_count, 
        share_count, 
        save_count, 
        follower_count,
        target_engagement,
        post_date,
        updated_at
      FROM reports 
      WHERE like_count IS NOT NULL 
        AND comment_count IS NOT NULL 
        AND view_count IS NOT NULL
        AND follower_count IS NOT NULL
        AND follower_count > 0
      ORDER BY post_date DESC
      LIMIT ? OFFSET ?
    `, [perPage, offset]);

    // Calculate engagement rate for each report
    const analyticsData = reports.map(report => {
      const totalEngagements = (report.like_count || 0) + (report.comment_count || 0) + 
                              (report.share_count || 0) + (report.save_count || 0);
      const engagementRate = report.follower_count > 0 
        ? ((totalEngagements / report.follower_count) * 100).toFixed(2)
        : 0;

      return {
        ...report,
        engagement_rate: parseFloat(engagementRate),
        total_engagements: totalEngagements
      };
    });

    res.render('reports/analytics', {
      reports: analyticsData,
      formatDate,
      formatDateTime,
      title: "Analytics & Target Setting",
      pagination: {
        totalItems: total,
        totalPages,
        currentPage,
        perPage,
        allowedPerPage,
        offset
      }
    });
  } catch (err) {
    console.error("Error GET /analytics:", err);
    res.status(500).send(err.message);
  }
});

// 📌 UPDATE TARGET: Save target engagement rate
router.post('/update-target', async (req, res) => {
  try {
    const { report_id, target_engagement } = req.body;
    
    if (!report_id || target_engagement === undefined) {
      return res.redirect('/reports/analytics?target_saved=0&msg=Data%20tidak%20lengkap');
    }

    const targetValue = parseFloat(target_engagement) || 0;

    await db.query(
      "UPDATE reports SET target_engagement = ? WHERE id = ?",
      [targetValue, report_id]
    );

    return res.redirect(`/reports/analytics?target_saved=1&target=${encodeURIComponent(targetValue)}`);
  } catch (err) {
    console.error("Error updating target:", err);
    return res.redirect('/reports/analytics?target_saved=0&msg=Gagal%20menyimpan%20target');
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