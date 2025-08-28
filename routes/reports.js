var express = require('express');
var router = express.Router();
const db = require('../config/db');
const { formatDate, formatDateTime } = require('../utils/dateHelper');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Middleware untuk menyimpan data sementara
const saveTempData = (req, res, next) => {
  if (req.method === 'POST' && req.path === '/update') {
    // Simpan data ke session sebelum redirect
    req.session.tempUpdateData = {
      ids: req.body['ids[]'],
      like_count: req.body['like_count[]'],
      comment_count: req.body['comment_count[]'],
      view_count: req.body['view_count[]'],
      share_count: req.body['share_count[]'],
      save_count: req.body['save_count[]'],
      follower_count: req.body['follower_count[]']
    };
  }
  next();
};

// Helper function to check if target is achieved
function isTargetAchieved(engagementRate, targetRate) {
    if (!targetRate || targetRate <= 0) return false;
    // STRICT: Target tercapai hanya jika ER >= target (tanpa toleransi)
    return engagementRate >= targetRate;
}

// Configure Multer untuk upload gambar
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'public/uploads/';
    // Buat direktori jika belum ada
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate nama file unik dengan timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'report-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Hanya terima file gambar
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diperbolehkan!'), false);
    }
  }
});

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
      "SELECT *, updated_at, image_path FROM reports ORDER BY post_date DESC, created_at DESC LIMIT ? OFFSET ?",
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

// 📌 ACTION tambah report dengan image
router.post('/add', upload.single('image'), async (req, res) => {
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

    // Handle image upload
    let imagePath = null;
    if (req.file) {
      imagePath = 'uploads/' + req.file.filename;
    }

    await db.query(
      `INSERT INTO reports 
      (platform, judul, post_url, like_count, comment_count, view_count, share_count, save_count, follower_count, post_date, report_date, image_path) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
      [platform, judul, post_url, processedLike, processedComment, processedView, processedShare, processedSave, processedFollower, post_date, imagePath]
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

// 📌 Route UPDATE
router.get('/update', async (req, res) => {
  try {
    const today = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(today.getDate() - 30); // 30 hari ke belakang

    // Pagination params
    const allowedPerPage = [5, 10, 50, 100];
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const perPageRaw = parseInt(req.query.perPage) || 10;
    const perPage = allowedPerPage.includes(perPageRaw) ? perPageRaw : 10;

    // Count reports from last 30 days
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM reports WHERE post_date >= ?`,
      [cutoffDate.toISOString().split('T')[0]]
    );
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * perPage;

    // Get paginated reports from last 30 days
    const [reports] = await db.query(
      `SELECT id, judul, post_url, post_date 
       FROM reports 
       WHERE post_date >= ? 
       ORDER BY post_date DESC, created_at DESC 
       LIMIT ? OFFSET ?`,
      [cutoffDate.toISOString().split('T')[0], perPage, offset]
    );

    // Ambil data sementara dari session jika ada
    const tempData = req.session.tempUpdateData || {};

    res.render('reports/update', {
      reports: reports,
      title: "Update Reports (30 Hari Terakhir)",
      tempData: tempData, // Kirim data sementara ke view
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

    // Simpan data ke session untuk digunakan di halaman lain
    req.session.tempUpdateData = {
      ids: ids,
      like_count: like_count,
      comment_count: comment_count,
      view_count: view_count,
      share_count: share_count,
      save_count: save_count,
      follower_count: follower_count
    };

    // Validasi data
    if (!ids || ids.length === 0 || ids[0] === undefined) {
      return res.status(400).send("Tidak ada data dikirim");
    }

    // Validasi data - izinkan nilai 0 dan field kosong
    for (let i = 0; i < ids.length; i++) {
      const fieldValues = [
        like_count[i],
        comment_count[i],
        view_count[i],
        share_count[i],
        save_count[i],
        follower_count[i]
      ];

      // Validasi field tidak boleh negatif, tapi boleh 0 atau kosong
      for (let j = 0; j < fieldValues.length; j++) {
        const value = fieldValues[j];
        if (value !== '' && value !== null && value !== undefined) {
          const numValue = parseInt(value);
          if (isNaN(numValue) || numValue < 0) {
            return res.status(400).send(`Field ${['like_count', 'comment_count', 'view_count', 'share_count', 'save_count', 'follower_count'][j]} untuk ID ${ids[i]} tidak valid (harus angka >= 0)`);
          }
        }
      }
    }

    let updatedCount = 0;
    let errors = [];

    // Update setiap record
    for (let i = 0; i < ids.length; i++) {
      try {
        const id = parseInt(ids[i]);
        
        // Parse values dengan handling untuk field kosong
        const parseValue = (value) => {
          if (value === '' || value === null || value === undefined) {
            return null; // Biarkan NULL untuk field kosong
          }
          const num = parseInt(value);
          return isNaN(num) ? null : num;
        };
        
        const like = parseValue(like_count[i]);
        const comment = parseValue(comment_count[i]);
        const view = parseValue(view_count[i]);
        const share = parseValue(share_count[i]);
        const save = parseValue(save_count[i]);
        const follower = parseValue(follower_count[i]);

        // Skip jika semua field kosong untuk report ini
        if (like === null && comment === null && view === null && 
            share === null && save === null && follower === null) {
          continue; // Skip report ini, tidak ada yang diupdate
        }

        // Update database dengan nilai yang valid
        const [result] = await db.query(
          `UPDATE reports 
           SET like_count = ?, comment_count = ?, view_count = ?, share_count = ?, save_count = ?, follower_count = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [like, comment, view, share, save, follower, id]
        );

        if (result.affectedRows > 0) {
          updatedCount++;

          // Auto-update target_achieved_date setelah update data
          try {
            // Hanya update target date jika semua field yang diperlukan tersedia
            if (like !== null && comment !== null && view !== null && 
                share !== null && save !== null && follower !== null) {
              
              const [formulas] = await db.query(
                "SELECT * FROM formula_settings WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
              );

              if (formulas.length > 0) {
                const currentFormula = formulas[0];
                let formula = currentFormula.engagement_formula;
                formula = formula.replace(/like/g, like);
                formula = formula.replace(/comment/g, comment);
                formula = formula.replace(/view/g, view);
                formula = formula.replace(/share/g, share);
                formula = formula.replace(/save/g, save);
                formula = formula.replace(/follower/g, follower);

                const engagementRate = eval(formula);

                // Get current target
                const [[currentReport]] = await db.query(
                  "SELECT target_engagement FROM reports WHERE id = ?",
                  [id]
                );

                // PERBAIKAN: target harus > 0 untuk dianggap valid
                if (currentReport && currentReport.target_engagement !== null && currentReport.target_engagement > 0) {
                  let targetAchievedDate = null;
                  if (isTargetAchieved(engagementRate, currentReport.target_engagement)) {
                    targetAchievedDate = new Date().toISOString().split('T')[0];
                  }
                  
                  await db.query(
                    "UPDATE reports SET target_achieved_date = ? WHERE id = ?",
                    [targetAchievedDate, id]
                  );
                }
              }
            }
          } catch (autoUpdateError) {
            console.error('Auto-update target date error:', autoUpdateError);
            // Don't fail the main update if auto-update fails
          }
        } else {
          // Ini seharusnya tidak terjadi karena kita sudah skip field kosong
          console.log(`No changes for ID ${id} - this should not happen`);
        }
      } catch (updateError) {
        errors.push(`Error untuk ID ${ids[i]}: ${updateError.message}`);
      }
    }

    // Hapus data sementara dari session setelah update berhasil
    delete req.session.tempUpdateData;
    
    // Tampilkan pesan yang lebih informatif
    let redirectUrl = `/reports?updated=${updatedCount}`;
    if (errors.length > 0) {
      redirectUrl += `&errors=${errors.length}`;
    }
    if (updatedCount === 0) {
      redirectUrl += `&message=no_updates`;
    }
    
    res.redirect(redirectUrl);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).send("Error: " + err.message);
  }
});

// 📌 ANALYTICS: Update untuk tanpa target formula dan tanpa pembulatan
router.get('/analytics', async (req, res) => {
  try {
    // Get active formula
    const [formulas] = await db.query(
      "SELECT * FROM formula_settings WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
    );
    
    const currentFormula = formulas.length > 0 ? formulas[0] : {
      engagement_formula: '(like + comment + share + save) / view * 100'
    };

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
        target_achieved_date,
        image_path
      FROM reports 
      WHERE like_count IS NOT NULL 
        AND comment_count IS NOT NULL 
        AND view_count IS NOT NULL
        AND follower_count IS NOT NULL
        AND follower_count > 0
      ORDER BY post_date DESC, created_at DESC
      LIMIT ? OFFSET ?
    `, [perPage, offset]);
    
    const analyticsData = reports.map(report => {
      // Dynamic formula evaluation dengan penamaan sederhana
      let engagementRate = 0;
      try {
        // Replace variables dengan penamaan sederhana
        let formula = currentFormula.engagement_formula;
        formula = formula.replace(/like/g, report.like_count || 0);
        formula = formula.replace(/comment/g, report.comment_count || 0);
        formula = formula.replace(/view/g, report.view_count || 0);
        formula = formula.replace(/share/g, report.share_count || 0);
        formula = formula.replace(/save/g, report.save_count || 0);
        formula = formula.replace(/follower/g, report.follower_count || 0);
        
        // Evaluate formula (tanpa pembulatan)
        engagementRate = eval(formula);
        engagementRate = isNaN(engagementRate) ? 0 : parseFloat(engagementRate);
        
      } catch (e) {
        console.error('Formula evaluation error:', e);
        engagementRate = 0;
      }

      const totalEngagements = (report.like_count || 0) + (report.comment_count || 0) + 
                              (report.share_count || 0) + (report.save_count || 0);
      return {
        ...report,
        engagement_rate: engagementRate,
        total_engagements: totalEngagements
      };
    });

    res.render('reports/analytics', {
      reports: analyticsData,
      currentFormula,
      formatDate,
      formatDateTime,
      title: "Report Analytics",
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

// 📌 CETAK REPORT - Form filter & opsi
router.get('/print', async (req, res) => {
  try {
    res.render('reports/print', {
      title: 'Cetak Report',
    });
  } catch (err) {
    console.error('Error GET /print:', err);
    res.status(500).send(err.message);
  }
});

// 📌 CETAK REPORT - Hasil
router.get('/print/export', async (req, res) => {
  try {
    const { start_date, end_date, include_thumbnails, format, selected_insights } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).send('Tanggal mulai dan akhir wajib diisi');
    }

    const includeThumbs = String(include_thumbnails) === '1';
    const exportFormat = (format || 'pdf').toLowerCase();

    // Parse selected insights (comma-separated), default to all if empty
    const defaultInsights = ['view', 'like', 'comment', 'share', 'save', 'er'];
    const selectedInsights = (selected_insights || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const insights = selectedInsights.length ? selectedInsights : defaultInsights;

    const [reports] = await db.query(`
      SELECT id, judul, post_url, post_date, like_count, comment_count, view_count, share_count, save_count, follower_count, image_path
      FROM reports
      WHERE post_date BETWEEN ? AND ?
      ORDER BY post_date DESC, created_at DESC
    `, [start_date, end_date]);

    // Aggregate totals for insights
    const totals = reports.reduce((acc, r) => {
      acc.view += Number(r.view_count || 0);
      acc.like += Number(r.like_count || 0);
      acc.comment += Number(r.comment_count || 0);
      acc.share += Number(r.share_count || 0);
      acc.save += Number(r.save_count || 0);
      return acc;
    }, { view: 0, like: 0, comment: 0, share: 0, save: 0 });

    // Perubahan insight seperti follower: bandingkan nilai awal vs akhir dalam rentang
    const sortedByDate = reports
      .slice()
      .filter(r => r.post_date)
      .sort((a, b) => new Date(a.post_date) - new Date(b.post_date));

    const pickStartEnd = (key) => {
      const series = sortedByDate.filter(r => r[key] !== null && r[key] !== undefined);
      if (series.length === 0) return { start: null, end: null, diff: null, pct: null };
      const startVal = Number(series[0][key]);
      const endVal = Number(series[series.length - 1][key]);
      const diff = endVal - startVal;
      const pct = startVal > 0 ? (diff / startVal) * 100 : null;
      return { start: startVal, end: endVal, diff, pct };
    };

    const metricChange = {
      view: pickStartEnd('view_count'),
      like: pickStartEnd('like_count'),
      comment: pickStartEnd('comment_count'),
      share: pickStartEnd('share_count'),
      save: pickStartEnd('save_count')
    };

    // Calculate follower change (earliest vs latest by post_date with non-null follower_count)
    let followerChange = { start: null, end: null, diff: null, pct: null };
    const followerSeries = reports
      .filter(r => r.follower_count !== null && r.follower_count !== undefined)
      .slice()
      .sort((a, b) => new Date(a.post_date) - new Date(b.post_date));
    if (followerSeries.length >= 1) {
      const startFollower = Number(followerSeries[0].follower_count);
      const endFollower = Number(followerSeries[followerSeries.length - 1].follower_count);
      const diff = endFollower - startFollower;
      const pct = startFollower > 0 ? (diff / startFollower) * 100 : null;
      followerChange = { start: startFollower, end: endFollower, diff, pct };
    }

    // Hitung rata-rata ER per posting menggunakan formula aktif
    const [formulas] = await db.query(
      "SELECT * FROM formula_settings WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
    );
    const currentFormula = formulas.length > 0 ? formulas[0] : {
      engagement_formula: '(like + comment + share + save) / view * 100'
    };
    let erSum = 0;
    let erCount = 0;
    for (const r of reports) {
      try {
        let formula = currentFormula.engagement_formula;
        formula = formula.replace(/like/g, r.like_count || 0);
        formula = formula.replace(/comment/g, r.comment_count || 0);
        formula = formula.replace(/view/g, r.view_count || 0);
        formula = formula.replace(/share/g, r.share_count || 0);
        formula = formula.replace(/save/g, r.save_count || 0);
        formula = formula.replace(/follower/g, r.follower_count || 0);
        const erVal = eval(formula);
        const erNum = isNaN(erVal) ? 0 : Number(erVal);
        erSum += erNum;
        erCount += 1;
      } catch (e) {
        // skip error
      }
    }
    const averageER = erCount > 0 ? (erSum / erCount) : 0;

    // Set header untuk Excel jika dipilih
    if (exportFormat === 'excel') {
      res.setHeader('Content-Type', 'application/vnd.ms-excel');
      res.setHeader('Content-Disposition', `attachment; filename="report_${start_date}_to_${end_date}.xls"`);
    }

    res.render('reports/print_export', {
      title: 'Cetak Report',
      reports,
      start_date,
      end_date,
      includeThumbs,
      formatDate,
      insights,
      totals,
      followerChange,
      metricChange,
      averageER
    });
  } catch (err) {
    console.error('Error GET /print/export:', err);
    res.status(500).send(err.message);
  }
});

// 📌 FORMULA: Halaman custom formula
router.get('/formula', async (req, res) => {
  try {
    // Get current active formula
    const [formulas] = await db.query(
      "SELECT * FROM formula_settings WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
    );

    const currentFormula = formulas.length > 0 ? formulas[0] : null;

    res.render('reports/formula', {
      title: 'Custom Formula ER dan Target',
      currentFormula,
      message: req.query.message || null,
      success: req.query.success || false
    });
  } catch (err) {
    console.error("Error GET /formula:", err);
    res.status(500).send(err.message);
  }
});

// 📌 SAVE FORMULA: Simpan formula custom (hanya ER)
router.post('/save-formula', async (req, res) => {
  try {
    const { engagement_formula } = req.body;
    
    if (!engagement_formula) {
      return res.redirect('/reports/formula?success=false&message=Formula%20tidak%20lengkap');
    }

    // Deactivate all existing formulas
    await db.query("UPDATE formula_settings SET is_active = FALSE");
    
    // Insert new formula (hanya engagement_formula)
    await db.query(
      "INSERT INTO formula_settings (name, engagement_formula) VALUES (?, ?)",
      [`Formula_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`, engagement_formula]
    );

    res.redirect('/reports/formula?success=true&message=Formula%20berhasil%20disimpan');
  } catch (err) {
    console.error("Error saving formula:", err);
    res.redirect('/reports/formula?success=false&message=Gagal%20menyimpan%20formula');
  }
});

// 📌 UPDATE TARGET: Update dengan target_achieved_date otomatis (tanpa pembulatan)
router.post('/update-target', async (req, res) => {
  try {
    const { report_id, target_engagement } = req.body;
    
    if (!report_id || target_engagement === undefined) {
      return res.redirect('/reports/analytics?target_saved=0&msg=Data%20tidak%20lengkap');
    }

    const targetValue = Number(target_engagement);

    // Validasi target harus > 0
    if (targetValue <= 0 || isNaN(targetValue)) {
      return res.redirect('/reports/analytics?target_saved=0&msg=Target%20harus%20lebih%20besar%20dari%200');
    }

    // Check if target already exists
    const [[existingTarget]] = await db.query(
      "SELECT target_engagement FROM reports WHERE id = ? AND target_engagement IS NOT NULL",
      [report_id]
    );

    if (existingTarget && existingTarget.target_engagement !== null) {
      return res.redirect('/reports/analytics?target_saved=0&msg=Target%20sudah%20ada.%20Gunakan%20tombol%20Reset%20untuk%20mengubah');
    }

    // Get current engagement rate menggunakan formula custom
    const [formulas] = await db.query(
      "SELECT * FROM formula_settings WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
    );
    
    const currentFormula = formulas.length > 0 ? formulas[0] : {
      engagement_formula: '(like_count + comment_count + share_count + save_count) / view_count * 100'
    };

    // Get current engagement rate
    const [[report]] = await db.query(`
      SELECT 
        like_count, comment_count, view_count, share_count, save_count, follower_count
      FROM reports 
      WHERE id = ?
    `, [report_id]);

    let engagementRate = 0;
    try {
      // Calculate engagement rate using custom formula
      let formula = currentFormula.engagement_formula;
      formula = formula.replace(/like/g, report.like_count || 0);
      formula = formula.replace(/comment/g, report.comment_count || 0);
      formula = formula.replace(/view/g, report.view_count || 0);
      formula = formula.replace(/share/g, report.share_count || 0);
      formula = formula.replace(/save/g, report.save_count || 0);
      formula = formula.replace(/follower/g, report.follower_count || 0);
      
      engagementRate = eval(formula);
      engagementRate = isNaN(engagementRate) ? 0 : parseFloat(engagementRate); // TANPA toFixed(2)
    } catch (e) {
      console.error('Formula evaluation error:', e);
      engagementRate = 0;
    }

    // Check if target achieved - PERBAIKAN: target harus > 0 dan ER >= target
    let targetAchievedDate = null;
    if (targetValue > 0 && isTargetAchieved(engagementRate, targetValue)) {
      targetAchievedDate = new Date().toISOString().split('T')[0];
    }

    await db.query(
      "UPDATE reports SET target_engagement = ?, target_achieved_date = ? WHERE id = ?",
      [targetValue, targetAchievedDate, report_id]
    );

    return res.redirect(`/reports/analytics?target_saved=1&target=${encodeURIComponent(targetValue)}`);
  } catch (err) {
    console.error("Error updating target:", err);
    return res.redirect('/reports/analytics?target_saved=0&msg=Gagal%20menyimpan%20target');
  }
});

router.post('/auto-update-target-date', async (req, res) => {
  try {
    const { report_id } = req.body;
    
    if (!report_id) {
      return res.status(400).json({ success: false, message: 'Report ID required' });
    }

    // Get current formula
    const [formulas] = await db.query(
      "SELECT * FROM formula_settings WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
    );
    
    const currentFormula = formulas.length > 0 ? formulas[0] : {
      engagement_formula: '(like_count + comment_count + share_count + save_count) / view_count * 100',
      target_formula: '5.0'
    };

    // Get report data
    const [[report]] = await db.query(`
      SELECT 
        like_count, comment_count, view_count, share_count, save_count, 
        follower_count, target_engagement, target_achieved_date
      FROM reports 
      WHERE id = ?
    `, [report_id]);

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    // Calculate current engagement rate (tanpa pembulatan)
    let engagementRate = 0;
    try {
      let formula = currentFormula.engagement_formula;
      formula = formula.replace(/like/g, report.like_count || 0);
      formula = formula.replace(/comment/g, report.comment_count || 0);
      formula = formula.replace(/view/g, report.view_count || 0);
      formula = formula.replace(/share/g, report.share_count || 0);
      formula = formula.replace(/save/g, report.save_count || 0);
      formula = formula.replace(/follower/g, report.follower_count || 0);
      
      engagementRate = eval(formula);
      engagementRate = isNaN(engagementRate) ? 0 : parseFloat(engagementRate);
    } catch (e) {
      console.error('Formula evaluation error:', e);
      engagementRate = 0;
    }

    // Update target_achieved_date - PERBAIKAN LOGIKA
    let targetAchievedDate = report.target_achieved_date;
    if (report.target_engagement && report.target_engagement > 0) {
      if (isTargetAchieved(engagementRate, report.target_engagement)) {
        if (!targetAchievedDate) {
          targetAchievedDate = new Date().toISOString().split('T')[0];
        }
      } else {
        targetAchievedDate = null;
      }
    }

    await db.query(
      "UPDATE reports SET target_achieved_date = ? WHERE id = ?",
      [targetAchievedDate, report_id]
    );

    return res.json({
      success: true,
      target_achieved_date: targetAchievedDate,
      engagement_rate: engagementRate,
      target: report.target_engagement
    });
  } catch (err) {
    console.error("Error auto-updating target date:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 📌 RESET TARGET: Reset target engagement rate
router.post('/reset-target', async (req, res) => {
  try {
    const { report_id } = req.body;

    if (!report_id) {
      return res.status(400).json({ success: false, message: 'Report ID required' });
    }

    // Reset target dan target_achieved_date
    await db.query(
      "UPDATE reports SET target_engagement = NULL, target_achieved_date = NULL WHERE id = ?",
      [report_id]
    );

    return res.json({
      success: true,
      message: 'Target berhasil direset'
    });
  } catch (err) {
    console.error("Error resetting target:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 📌 GET TEMP DATA: Ambil data sementara dari session
router.get('/get-temp-data', async (req, res) => {
  try {
    const tempData = req.session.tempUpdateData || {};
    return res.json({
      success: true,
      data: tempData
    });
  } catch (err) {
    console.error("Error getting temp data:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 📌 CLEAR TEMP DATA: Hapus data sementara dari session
router.post('/clear-temp-data', async (req, res) => {
  try {
    delete req.session.tempUpdateData;
    return res.json({
      success: true,
      message: "Data sementara berhasil dihapus"
    });
  } catch (err) {
    console.error("Error clearing temp data:", err);
    return res.status(500).json({ success: false, message: err.message });
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
