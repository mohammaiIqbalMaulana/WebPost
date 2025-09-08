var express = require('express');
var router = express.Router();
const db = require('../config/db');
const { formatDate, formatDateTime } = require('../utils/dateHelper');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

// Helper function untuk format data chart
function prepareChartData(reports, insights, mode = 'normal', monthlyData = null) {
  const colors = {
    view: '#007bff',    // primary blue
    like: '#dc3545',    // danger red
    comment: '#28a745', // success green
    share: '#17a2b8',   // info cyan
    save: '#ffc107',    // warning yellow
    er: '#6f42c1'       // purple
  };

  if (mode === 'normal') {
    // Mode Normal: Data per post dengan tanggal
    const chartData = {
      labels: reports.map(r => new Date(r.post_date).toLocaleDateString('id-ID', { 
        day: '2-digit', 
        month: 'short' 
      })),
      datasets: []
    };

    // Tambahkan dataset untuk setiap insight yang dipilih
    insights.forEach(insight => {
      if (insight === 'er') {
        // Hitung ER untuk setiap post
        const erData = reports.map(r => {
          const like = r.like_count || 0;
          const comment = r.comment_count || 0;
          const share = r.share_count || 0;
          const save = r.save_count || 0;
          const view = r.view_count || 1;
          return ((like + comment + share + save) / view * 100);
        });

        chartData.datasets.push({
          label: 'Engagement Rate (%)',
          data: erData,
          borderColor: colors.er,
          backgroundColor: colors.er + '20',
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          yAxisID: 'y1'
        });
      } else {
        const key = insight + '_count';
        chartData.datasets.push({
          label: insight.charAt(0).toUpperCase() + insight.slice(1),
          data: reports.map(r => r[key] || 0),
          borderColor: colors[insight],
          backgroundColor: colors[insight] + '20',
          borderWidth: 2,
          fill: false,
          tension: 0.3
        });
      }
    });

    return chartData;
  } else {
    // Mode Perbandingan: Data per bulan
    const monthNames = monthlyData.map(m => m.monthName);
    const chartData = {
      labels: monthNames,
      datasets: []
    };

    insights.forEach(insight => {
      if (insight === 'er') {
        chartData.datasets.push({
          label: 'Avg ER (%)',
          data: monthlyData.map(m => m.averageER || 0),
          borderColor: colors.er,
          backgroundColor: colors.er + '20',
          borderWidth: 3,
          fill: false,
          tension: 0.3,
          yAxisID: 'y1'
        });
      } else {
        chartData.datasets.push({
          label: insight.charAt(0).toUpperCase() + insight.slice(1),
          data: monthlyData.map(m => m.totals[insight] || 0),
          borderColor: colors[insight],
          backgroundColor: colors[insight] + '20',
          borderWidth: 3,
          fill: false,
          tension: 0.3
        });
      }
    });

    return chartData;
  }
}

// Helper untuk follower chart data
function prepareFollowerChartData(monthlyData) {
  return {
    labels: monthlyData.map(m => m.monthName),
    datasets: [{
      label: 'Followers',
      data: monthlyData.map(m => m.followerCount || 0),
      borderColor: '#6f42c1',
      backgroundColor: '#6f42c1' + '30',
      borderWidth: 3,
      fill: true,
      tension: 0.3
    }]
  };
}

// Helper function to check if target is achieved
function isTargetAchieved(engagementRate, targetRate) {
    if (!targetRate || targetRate <= 0) return false;
    // STRICT: Target tercapai hanya jika ER >= target (tanpa toleransi)
    return engagementRate >= targetRate;
}

// Helper function to calculate post status based on post_date
function calculateStatus(postDate) {
  if (!postDate) return 'running';
  
  const post = new Date(postDate);
  const now = new Date();
  const diffTime = Math.abs(now - post);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays > 30 ? 'valid' : 'running';
}

// Helper function to get latest follower count by platform
async function getLatestFollowerCount(platform) {
  try {
    const [rows] = await db.query(
      "SELECT follower_count FROM followers WHERE platform = ? ORDER BY recorded_date DESC LIMIT 1",
      [platform]
    );
    return rows.length > 0 ? rows[0].follower_count : 0;
  } catch (error) {
    console.error('Error getting latest follower count:', error);
    return 0;
  }
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

// 📌 LIST semua reports dengan auto-update status
router.get('/', async (req, res) => {
  try {
    // Pagination params
    const allowedPerPage = [5, 10, 50, 100];
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const perPageRaw = parseInt(req.query.perPage) || 10;
    const perPage = allowedPerPage.includes(perPageRaw) ? perPageRaw : 10;

    // Auto-update status berdasarkan post_date
    await db.query(`
      UPDATE reports 
      SET status = CASE 
        WHEN DATEDIFF(CURDATE(), post_date) > 30 THEN 'valid'
        ELSE 'running'
      END
    `);

    const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM reports");
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * perPage;

    const [rows] = await db.query(
      "SELECT *, updated_at, image_path, status FROM reports ORDER BY post_date DESC, created_at DESC LIMIT ? OFFSET ?",
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

// 📌 ACTION tambah report dengan image (tanpa follower_count)
router.post('/add', upload.single('image'), async (req, res) => {
  try {
    let { platform, judul, post_url, like_count, comment_count, view_count, share_count, save_count, post_date } = req.body;

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

    // Calculate initial status
    const status = calculateStatus(post_date);

    // Handle image upload
    let imagePath = null;
    if (req.file) {
      imagePath = 'uploads/' + req.file.filename;
    }

    await db.query(
      `INSERT INTO reports 
      (platform, judul, post_url, like_count, comment_count, view_count, share_count, save_count, post_date, report_date, image_path, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
      [platform, judul, post_url, processedLike, processedComment, processedView, processedShare, processedSave, post_date, imagePath, status]
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

// 📌 Route UPDATE - hanya metrics (tanpa follower)
router.get('/update', async (req, res) => {
  try {
    const today = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(today.getDate() - 30); // 30 hari ke belakang

    // Get ALL reports from last 30 days (tanpa pagination)
    const [reports] = await db.query(
      `SELECT id, judul, post_url, post_date, like_count, comment_count, view_count, share_count, save_count
       FROM reports 
       WHERE post_date >= ? 
       ORDER BY post_date DESC, created_at DESC`,
      [cutoffDate.toISOString().split('T')[0]]
    );

    // Ambil data sementara dari session jika ada
    const tempData = req.session.tempUpdateData || {};

    res.render('reports/update', {
      reports: reports,
      title: "Update Reports (30 Hari Terakhir)",
      tempData: tempData // Kirim data sementara ke view
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

    // Simpan data ke session untuk digunakan di halaman lain
    req.session.tempUpdateData = {
      ids: ids,
      like_count: like_count,
      comment_count: comment_count,
      view_count: view_count,
      share_count: share_count,
      save_count: save_count
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
        save_count[i]
      ];

      // Validasi field tidak boleh negatif, tapi boleh 0 atau kosong
      for (let j = 0; j < fieldValues.length; j++) {
        const value = fieldValues[j];
        if (value !== '' && value !== null && value !== undefined) {
          const numValue = parseInt(value);
          if (isNaN(numValue) || numValue < 0) {
            return res.status(400).send(`Field ${['like_count', 'comment_count', 'view_count', 'share_count', 'save_count'][j]} untuk ID ${ids[i]} tidak valid (harus angka >= 0)`);
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

        // Validasi semua field harus diisi (tidak boleh kosong)
        if (like === null || comment === null || view === null || 
          share === null || save === null) {
        errors.push(`Report "${ids[i]}" - Semua field harus diisi, tidak boleh kosong`);
        continue;
        }

        // Update database dengan nilai yang valid
        const [result] = await db.query(
          `UPDATE reports 
           SET like_count = ?, comment_count = ?, view_count = ?, share_count = ?, save_count = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [like, comment, view, share, save, id]
        );

        if (result.affectedRows > 0) {
          updatedCount++;

          // Auto-update target_achieved_date setelah update data
          try {
            // Hanya update target date jika semua field yang diperlukan tersedia
            if (like !== null && comment !== null && view !== null && 
                share !== null && save !== null) {
              
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
                
                // Get follower count dari tabel followers jika formula menggunakan follower
                if (formula.includes('follower')) {
                  // Get platform dari report
                  const [[reportData]] = await db.query("SELECT platform FROM reports WHERE id = ?", [id]);
                  if (reportData) {
                    const followerCount = await getLatestFollowerCount(reportData.platform);
                    formula = formula.replace(/follower/g, followerCount);
                  }
                }

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

// 📌 UPDATE FOLLOWER - endpoint untuk update follower count ke tabel terpisah
router.post('/update-follower', async (req, res) => {
  try {
    const { platform, follower_count, recorded_date } = req.body;

    // Validasi input
    if (!platform || !follower_count || !recorded_date) {
      return res.status(400).json({ 
        success: false, 
        message: 'Platform, follower count, dan periode bulan harus diisi' 
      });
    }

    const followerNum = parseInt(follower_count);
    if (isNaN(followerNum) || followerNum < 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Follower count harus berupa angka >= 0' 
      });
    }

    // Validasi format tanggal (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(recorded_date)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Format tanggal tidak valid (YYYY-MM-DD)' 
      });
    }

    // Extract year-month untuk cek existing record
    const recordedYear = new Date(recorded_date).getFullYear();
    const recordedMonth = new Date(recorded_date).getMonth() + 1;
    
    // Cek apakah sudah ada record untuk platform dan bulan yang sama
    const [existingRecords] = await db.query(`
      SELECT id, follower_count, recorded_date, created_at 
      FROM followers 
      WHERE platform = ? 
        AND YEAR(recorded_date) = ? 
        AND MONTH(recorded_date) = ?
    `, [platform, recordedYear, recordedMonth]);

    let action = 'created';
    let recordId;

    if (existingRecords.length > 0) {
      // UPDATE existing record
      const existingRecord = existingRecords[0];
      await db.query(
        "UPDATE followers SET follower_count = ?, recorded_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [followerNum, recorded_date, existingRecord.id]
      );
      action = 'updated';
      recordId = existingRecord.id;
    } else {
      // INSERT new record
      const [insertResult] = await db.query(
        "INSERT INTO followers (platform, follower_count, recorded_date) VALUES (?, ?, ?)",
        [platform, followerNum, recorded_date]
      );
      recordId = insertResult.insertId;
      action = 'created';
    }

    // Format response dengan info yang jelas
    const monthName = new Date(recorded_date).toLocaleDateString('id-ID', { 
      month: 'long', 
      year: 'numeric' 
    });
    
    const updateDate = new Date().toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short', 
      year: 'numeric'
    });

    return res.json({
      success: true,
      message: `Data follower berhasil ${action === 'created' ? 'disimpan' : 'diperbarui'}`,
      data: {
        platform: platform.toUpperCase(),
        follower_count: followerNum.toLocaleString('id-ID'),
        period: monthName,
        update_date: updateDate,
        action: action,
        record_id: recordId
      }
    });

  } catch (err) {
    console.error("Error updating follower:", err);
    return res.status(500).json({ 
      success: false, 
      message: 'Gagal menyimpan data follower: ' + err.message 
    });
  }
});

// 📌 GET LATEST FOLLOWER - endpoint untuk mendapatkan follower count terbaru
router.get('/get-latest-follower/:platform', async (req, res) => {
  try {
    const { platform } = req.params;
    const followerCount = await getLatestFollowerCount(platform);
    
    return res.json({
      success: true,
      platform: platform,
      follower_count: followerCount
    });

  } catch (err) {
    console.error("Error getting latest follower:", err);
    return res.status(500).json({ 
      success: false, 
      message: 'Gagal mendapatkan data follower: ' + err.message 
    });
  }
});

// 📌 GET FOLLOWER INFO - New endpoint untuk info follower terbaru
router.get('/get-follower-info/:platform?', async (req, res) => {
  try {
    const platform = req.params.platform || 'tiktok';
    
    const [followerData] = await db.query(`
      SELECT follower_count, recorded_date, updated_at, created_at
      FROM followers 
      WHERE platform = ? 
      ORDER BY recorded_date DESC, updated_at DESC 
      LIMIT 1
    `, [platform]);

    if (followerData.length === 0) {
      return res.json({
        success: true,
        hasData: false,
        message: 'Belum ada data follower'
      });
    }

    const data = followerData[0];
    const monthName = new Date(data.recorded_date).toLocaleDateString('id-ID', { 
      month: 'long', 
      year: 'numeric' 
    });
    
    const updateDate = new Date(data.updated_at || data.created_at).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short', 
      year: 'numeric'
    });

    return res.json({
      success: true,
      hasData: true,
      platform: platform.toUpperCase(),
      follower_count: Number(data.follower_count),
      follower_count_formatted: Number(data.follower_count).toLocaleString('id-ID'),
      period: monthName,
      update_date: updateDate,
      recorded_date: data.recorded_date
    });

  } catch (err) {
    console.error("Error getting follower info:", err);
    return res.status(500).json({ 
      success: false, 
      message: 'Gagal mendapatkan info follower: ' + err.message 
    });
  }
});

// 📌 ANALYTICS: Update untuk ambil follower dari tabel terpisah
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
    `);
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * perPage;

    const [reports] = await db.query(`
      SELECT 
        id, 
        judul, 
        post_url, 
        platform,
        like_count, 
        comment_count, 
        view_count, 
        share_count, 
        save_count,
        target_engagement,
        target_achieved_date,
        image_path
      FROM reports 
      WHERE like_count IS NOT NULL 
        AND comment_count IS NOT NULL 
        AND view_count IS NOT NULL
      ORDER BY post_date DESC, created_at DESC
      LIMIT ? OFFSET ?
    `, [perPage, offset]);
    
    const analyticsData = [];
    
    for (const report of reports) {
      // Dynamic formula evaluation dengan follower dari tabel terpisah
      let engagementRate = 0;
      try {
        // Replace variables dengan penamaan sederhana
        let formula = currentFormula.engagement_formula;
        formula = formula.replace(/like/g, report.like_count || 0);
        formula = formula.replace(/comment/g, report.comment_count || 0);
        formula = formula.replace(/view/g, report.view_count || 0);
        formula = formula.replace(/share/g, report.share_count || 0);
        formula = formula.replace(/save/g, report.save_count || 0);
        
        // Get follower count dari tabel followers jika diperlukan
        if (formula.includes('follower')) {
          const followerCount = await getLatestFollowerCount(report.platform);
          formula = formula.replace(/follower/g, followerCount);
        }
        
        // Evaluate formula (tanpa pembulatan)
        engagementRate = eval(formula);
        engagementRate = isNaN(engagementRate) ? 0 : parseFloat(engagementRate);
        
      } catch (e) {
        console.error('Formula evaluation error:', e);
        engagementRate = 0;
      }

      const totalEngagements = (report.like_count || 0) + (report.comment_count || 0) + 
                              (report.share_count || 0) + (report.save_count || 0);
      
      analyticsData.push({
        ...report,
        engagement_rate: engagementRate,
        total_engagements: totalEngagements
      });
    }

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

// 📌 CETAK REPORT - Hasil dengan follower dari tabel terpisah
router.get('/print/export', async (req, res) => {
  try {
    const { start_date, end_date, include_thumbnails, format, selected_insights, compare, end_month, months } = req.query;

    const includeThumbs = String(include_thumbnails) === '1';
    const exportFormat = (format || 'pdf').toLowerCase();
    const isCompare = String(compare) === '1';

    // Parse selected insights (comma-separated), default to all if empty
    const defaultInsights = ['view', 'like', 'comment', 'share', 'save', 'er'];
    const selectedInsights = (selected_insights || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const insights = selectedInsights.length ? selectedInsights : defaultInsights;

    let reports = [];
    let monthlyData = [];
    let totals = { view: 0, like: 0, comment: 0, share: 0, save: 0 };
    let followerChange = { start: null, end: null, diff: null, pct: null };
    let metricChange = {};
    let averageER = 0;
    let totalPostingan = 0;
    // Prepare chart data
    let chartData = null;
    let followerChartData = null;

    // FIXED: Variables untuk actual date range yang akan digunakan
    let actualStartDate, actualEndDate;

    if (isCompare && end_month && months) {
      // MODE PERBANDINGAN
      console.log('🔧 MODE PERBANDINGAN AKTIF');
      
      if (!end_month) {
        return res.status(400).send('End month harus diisi untuk mode perbandingan');
      }

      const numMonths = parseInt(months) || 3;
      const [endYear, endMonthNum] = end_month.split('-').map(Number);

      console.log('📊 Perbandingan Config:');
      console.log('- End Month:', end_month);
      console.log('- Number of months:', numMonths);
      console.log('- Parsed: endYear=', endYear, 'endMonthNum=', endMonthNum);

      // FIXED: Calculate actual date range untuk query postingan
      // Start dari bulan pertama dalam comparison
      let startYear = endYear;
      let startMonth = endMonthNum - (numMonths - 1);
      
      while (startMonth <= 0) {
        startMonth += 12;
        startYear--;
      }
      
      actualStartDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
      actualEndDate = new Date(endYear, endMonthNum, 0).toISOString().split('T')[0];
      
      console.log('📅 Calculated date range:');
      console.log('- actualStartDate:', actualStartDate);
      console.log('- actualEndDate:', actualEndDate);

      // Generate array of months to compare (oldest to newest)
      const compareMonths = [];
      let currentYear = startYear;
      let currentMonth = startMonth;

      for (let i = 0; i < numMonths; i++) {
        const monthData = {
          year: currentYear,
          month: currentMonth,
          monthName: new Date(currentYear, currentMonth - 1, 1).toLocaleDateString('id-ID', { 
            month: 'long', 
            year: 'numeric' 
          }),
          startDate: `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`,
          endDate: new Date(currentYear, currentMonth, 0).toISOString().split('T')[0]
        };
        
        console.log(`📅 Month ${i + 1}:`, monthData);
        compareMonths.push(monthData);

        // Move to next month
        currentMonth++;
        if (currentMonth === 13) {
          currentMonth = 1;
          currentYear++;
        }
      }

      // FIXED: Get posts ONLY from calculated date range
      console.log('🔍 Querying posts from:', actualStartDate, 'to:', actualEndDate);
      
      const [allReports] = await db.query(`
        SELECT id, platform, judul, post_url, post_date, like_count, comment_count, view_count, share_count, save_count, image_path, status
        FROM reports
        WHERE post_date BETWEEN ? AND ?
        ORDER BY post_date DESC, created_at DESC
      `, [actualStartDate, actualEndDate]);

      console.log('📋 Found posts:', allReports.length);
      allReports.forEach(r => {
        console.log(`- ${r.judul} (${r.post_date})`);
      });

      // Get ALL follower data for comparison period
      let allFollowerData = [];
      try {
        const [followerRecords] = await db.query(`
          SELECT follower_count, recorded_date
          FROM followers
          WHERE platform = 'tiktok'
          ORDER BY recorded_date DESC
        `);
        allFollowerData = followerRecords;
        console.log('👥 Follower records found:', allFollowerData.length);
      } catch (followerError) {
        console.error('Error getting follower data:', followerError);
      }

      // Process each month
      for (const monthData of compareMonths) {
        console.log(`\n🗓️  Processing month: ${monthData.monthName}`);
        
        // Get follower data for this month
        let followerCount = null;
        try {
          const monthEndDate = new Date(monthData.endDate);
          let closestFollower = null;
          let minDiff = Infinity;

          for (const follower of allFollowerData) {
            const followerDate = new Date(follower.recorded_date);
            const diff = monthEndDate - followerDate;

            if (diff >= 0 && diff < minDiff) {
              minDiff = diff;
              closestFollower = follower;
            }
          }

          if (closestFollower) {
            followerCount = Number(closestFollower.follower_count);
            console.log(`👥 Follower for ${monthData.monthName}:`, followerCount);
          } else {
            console.log(`❌ No follower data for ${monthData.monthName}`);
          }
        } catch (followerError) {
          console.error('Error processing follower for month:', followerError);
        }

        // Filter posts for this specific month
        const monthReports = allReports.filter(report => {
          const reportDate = new Date(report.post_date);
          const monthStart = new Date(monthData.startDate);
          const monthEnd = new Date(monthData.endDate);
          const isInMonth = reportDate >= monthStart && reportDate <= monthEnd;
          
          if (isInMonth) {
            console.log(`✅ Post "${report.judul}" belongs to ${monthData.monthName}`);
          }
          
          return isInMonth;
        });

        console.log(`📊 Posts in ${monthData.monthName}:`, monthReports.length);

        // Aggregate metrics for this month
        const monthTotals = monthReports.reduce((acc, r) => {
          acc.view += Number(r.view_count || 0);
          acc.like += Number(r.like_count || 0);
          acc.comment += Number(r.comment_count || 0);
          acc.share += Number(r.share_count || 0);
          acc.save += Number(r.save_count || 0);
          return acc;
        }, { view: 0, like: 0, comment: 0, share: 0, save: 0 });

        // Calculate ER for this month
        let monthER = 0;
        if (monthReports.length > 0) {
          const [formulas] = await db.query(
            "SELECT * FROM formula_settings WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
          );
          const currentFormula = formulas.length > 0 ? formulas[0] : {
            engagement_formula: '(like + comment + share + save) / view * 100'
          };

          let erSum = 0;
          let erCount = 0;

          for (const r of monthReports) {
            try {
              let formula = currentFormula.engagement_formula;
              formula = formula.replace(/like/g, r.like_count || 0);
              formula = formula.replace(/comment/g, r.comment_count || 0);
              formula = formula.replace(/view/g, r.view_count || 0);
              formula = formula.replace(/share/g, r.share_count || 0);
              formula = formula.replace(/save/g, r.save_count || 0);

              if (formula.includes('follower')) {
                const followerCountVal = await getLatestFollowerCount(r.platform);
                formula = formula.replace(/follower/g, followerCountVal);
              }

              const erVal = eval(formula);
              const erNum = isNaN(erVal) ? 0 : Number(erVal);
              erSum += erNum;
              erCount += 1;
            } catch (e) {
              console.error('ER calculation error:', e);
            }
          }

          monthER = erCount > 0 ? (erSum / erCount) : 0;
        }

        monthlyData.push({
          ...monthData,
          reports: monthReports,
          followerCount,
          totals: monthTotals,
          hasPosts: monthReports.length > 0,
          postCount: monthReports.length,
          averageER: monthER
        });

        // Add to overall totals
        totals.view += monthTotals.view;
        totals.like += monthTotals.like;
        totals.comment += monthTotals.comment;
        totals.share += monthTotals.share;
        totals.save += monthTotals.save;
        totalPostingan += monthReports.length;
      }

      // Calculate follower change
      const validFollowers = monthlyData.filter(m => m.followerCount !== null);
        
        if (validFollowers.length >= 1) {
          // Ambil bulan terakhir sebagai referensi
          const referenceMonth = validFollowers[validFollowers.length - 1];
          const referenceFollower = referenceMonth.followerCount;
          
          // Hitung rata-rata follower dari bulan-bulan sebelumnya
          const otherMonths = validFollowers.slice(0, -1);
          const avgOtherFollower = otherMonths.length > 0 
            ? otherMonths.reduce((sum, m) => sum + m.followerCount, 0) / otherMonths.length 
            : referenceFollower;
          
          const diff = referenceFollower - avgOtherFollower;
          const pct = avgOtherFollower > 0 ? (diff / avgOtherFollower) * 100 : 0;
          
          followerChange = { 
            start: Math.round(avgOtherFollower), 
            end: referenceFollower, 
            diff: Math.round(diff), 
            pct 
          };
        }

      // Calculate metric changes
      const calculateReferenceComparison = (key) => {
          const monthsWithData = monthlyData.filter(m => m.hasPosts && m.totals[key] !== null);
          
          if (monthsWithData.length === 0) {
            return { start: null, end: null, diff: null, pct: null };
          }
          
          if (monthsWithData.length === 1) {
            // Hanya ada 1 bulan dengan data
            const singleValue = monthsWithData[0].totals[key];
            return { start: singleValue, end: singleValue, diff: 0, pct: 0 };
          }
          
          // Ambil bulan terakhir sebagai referensi
          const referenceMonth = monthsWithData[monthsWithData.length - 1];
          const referenceValue = referenceMonth.totals[key];
          
          // Hitung rata-rata dari bulan-bulan sebelumnya
          const otherMonths = monthsWithData.slice(0, -1);
          const avgOtherValue = otherMonths.reduce((sum, m) => sum + m.totals[key], 0) / otherMonths.length;
          
          const diff = referenceValue - avgOtherValue;
          
          let pct = null;
          if (avgOtherValue > 0) {
            pct = (diff / avgOtherValue) * 100;
          } else if (avgOtherValue === 0 && referenceValue > 0) {
            pct = 100;
          } else if (avgOtherValue === 0 && referenceValue === 0) {
            pct = 0;
          }

          return { 
            start: Math.round(avgOtherValue), 
            end: referenceValue, 
            diff: Math.round(diff), 
            pct 
          };
        };

        metricChange = {
          view: calculateReferenceComparison('view'),
          like: calculateReferenceComparison('like'),
          comment: calculateReferenceComparison('comment'),
          share: calculateReferenceComparison('share'),
          save: calculateReferenceComparison('save')
        };

      // Calculate overall average ER
      const validERs = monthlyData.filter(m => m.hasPosts).map(m => m.averageER);
        averageER = validERs.length > 0 ? (validERs.reduce((sum, er) => sum + er, 0) / validERs.length) : 0;

      // Populate reports array for Excel export
      reports = allReports;

      console.log('📈 FIXED Comparison Results:');
      console.log('- Reference month:', monthlyData[monthlyData.length - 1]?.monthName);
      console.log('- Total posts:', totalPostingan);
      console.log('- Average ER:', averageER);
      console.log('- Follower change (ref vs avg others):', followerChange);
      console.log('- Metric changes:', metricChange);

    } else {
      // MODE NORMAL - FIXED: Validate required fields
      if (!start_date || !end_date) {
        return res.status(400).send('Tanggal mulai dan akhir wajib diisi untuk mode normal');
      }
      
      actualStartDate = start_date;
      actualEndDate = end_date;
      
      console.log('🔧 MODE NORMAL AKTIF');
      console.log('📅 Date range:', actualStartDate, 'to', actualEndDate);

      const [singleReports] = await db.query(`
        SELECT id, platform, judul, post_url, post_date, like_count, comment_count, view_count, share_count, save_count, image_path, status
        FROM reports
        WHERE post_date BETWEEN ? AND ?
        ORDER BY post_date DESC, created_at DESC
      `, [actualStartDate, actualEndDate]);

      reports = singleReports;
      console.log('📋 Found posts:', reports.length);

      // Aggregate totals
      totals = singleReports.reduce((acc, r) => {
        acc.view += Number(r.view_count || 0);
        acc.like += Number(r.like_count || 0);
        acc.comment += Number(r.comment_count || 0);
        acc.share += Number(r.share_count || 0);
        acc.save += Number(r.save_count || 0);
        return acc;
      }, { view: 0, like: 0, comment: 0, share: 0, save: 0 });

      // Calculate metric changes (first vs last post)
      const sortedByDate = singleReports
        .slice()
        .filter(r => r.post_date)
        .sort((a, b) => new Date(a.post_date) - new Date(b.post_date));

      const pickStartEnd = (key) => {
        const series = sortedByDate.filter(r => r[key] !== null && r[key] !== undefined);
        if (series.length === 0) return { start: null, end: null, diff: null, pct: null };
        const startVal = Number(series[0][key]);
        const endVal = Number(series[series.length - 1][key]);
        const diff = endVal - startVal;

        let pct = null;
        if (startVal > 0) {
          pct = (diff / startVal) * 100;
        } else if (startVal === 0 && endVal > 0) {
          pct = 100;
        } else if (startVal === 0 && endVal === 0) {
          pct = 0;
        }

        return { start: startVal, end: endVal, diff, pct };
      };

      metricChange = {
        view: pickStartEnd('view_count'),
        like: pickStartEnd('like_count'),
        comment: pickStartEnd('comment_count'),
        share: pickStartEnd('share_count'),
        save: pickStartEnd('save_count')
      };

      // Calculate follower change
      try {
        const [followerData] = await db.query(`
          SELECT follower_count, recorded_date
          FROM followers
          WHERE platform = 'tiktok' AND recorded_date BETWEEN ? AND ?
          ORDER BY recorded_date ASC
        `, [actualStartDate, actualEndDate]);

        if (followerData.length >= 1) {
          const startFollower = Number(followerData[0].follower_count);
          const endFollower = Number(followerData[followerData.length - 1].follower_count);
          const diff = endFollower - startFollower;
          const pct = startFollower > 0 ? (diff / startFollower) * 100 : null;
          followerChange = { start: startFollower, end: endFollower, diff, pct };
        }
      } catch (followerError) {
        console.error('Error calculating follower change:', followerError);
      }

      // Calculate average ER
      const [formulas] = await db.query(
        "SELECT * FROM formula_settings WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
      );
      const currentFormula = formulas.length > 0 ? formulas[0] : {
        engagement_formula: '(like + comment + share + save) / view * 100'
      };
      
      let erSum = 0;
      let erCount = 0;

      for (const r of singleReports) {
        try {
          let formula = currentFormula.engagement_formula;
          formula = formula.replace(/like/g, r.like_count || 0);
          formula = formula.replace(/comment/g, r.comment_count || 0);
          formula = formula.replace(/view/g, r.view_count || 0);
          formula = formula.replace(/share/g, r.share_count || 0);
          formula = formula.replace(/save/g, r.save_count || 0);

          if (formula.includes('follower')) {
            const followerCount = await getLatestFollowerCount(r.platform);
            formula = formula.replace(/follower/g, followerCount);
          }

          const erVal = eval(formula);
          const erNum = isNaN(erVal) ? 0 : Number(erVal);
          erSum += erNum;
          erCount += 1;
        } catch (e) {
          console.error('ER calculation error:', e);
        }
      }

      totalPostingan = singleReports.length;
      averageER = erCount > 0 ? (erSum / erCount) : 0;
    }

    // Set header for Excel if selected
    if (exportFormat === 'excel') {
      // Create a new workbook
      const workbook = new ExcelJS.Workbook();

      // Get current formula for ER calculation
      const [formulas] = await db.query(
        "SELECT * FROM formula_settings WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
      );
      const currentFormula = formulas.length > 0 ? formulas[0] : {
        engagement_formula: '(like + comment + share + save) / view * 100'
      };

      // WORKSHEET 1: Posts Data
      const postsSheet = workbook.addWorksheet('Posts');
      postsSheet.columns = [
        { header: 'Platform', key: 'platform', width: 15 },
        { header: 'Judul', key: 'judul', width: 30 },
        { header: 'Post URL', key: 'post_url', width: 30 },
        { header: 'Post Date', key: 'post_date', width: 15 },
        { header: 'View', key: 'view_count', width: 10 },
        { header: 'Like', key: 'like_count', width: 10 },
        { header: 'Comment', key: 'comment_count', width: 10 },
        { header: 'Share', key: 'share_count', width: 10 },
        { header: 'Save', key: 'save_count', width: 10 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Engagement Rate', key: 'engagement_rate', width: 15 }
      ];

      // Add posts data with ER calculation
      for (const report of reports) {
        let engagementRate = 0;
        try {
          let formula = currentFormula.engagement_formula;
          formula = formula.replace(/like/g, report.like_count || 0);
          formula = formula.replace(/comment/g, report.comment_count || 0);
          formula = formula.replace(/view/g, report.view_count || 0);
          formula = formula.replace(/share/g, report.share_count || 0);
          formula = formula.replace(/save/g, report.save_count || 0);

          if (formula.includes('follower')) {
            const followerCount = await getLatestFollowerCount(report.platform);
            formula = formula.replace(/follower/g, followerCount);
          }

          const erVal = eval(formula);
          engagementRate = isNaN(erVal) ? 0 : Number(erVal);
        } catch (e) {
          console.error('ER calculation error for Excel:', e);
          engagementRate = 0;
        }

        postsSheet.addRow({
          platform: report.platform,
          judul: report.judul,
          post_url: report.post_url,
          post_date: report.post_date,
          view_count: report.view_count || 0,
          like_count: report.like_count || 0,
          comment_count: report.comment_count || 0,
          share_count: report.share_count || 0,
          save_count: report.save_count || 0,
          status: report.status || 'running',
          engagement_rate: engagementRate
        });
      }

      // Style posts sheet
      postsSheet.getRow(1).font = { bold: true };
      postsSheet.getRow(1).alignment = { horizontal: 'center' };
      postsSheet.autoFilter = { from: 'A1', to: 'J1' };
      ['E', 'F', 'G', 'H', 'I'].forEach(col => {
        postsSheet.getColumn(col).numFmt = '#,##0';
      });
      postsSheet.getColumn('J').numFmt = '0.00';

      // WORKSHEET 2: Summary Statistics
      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 20 },
        { header: 'Value', key: 'value', width: 15 },
        { header: 'Change', key: 'change', width: 15 },
        { header: 'Change %', key: 'change_pct', width: 15 }
      ];

      // Add summary data
      summarySheet.addRow({ metric: 'Total Posts', value: totalPostingan });
      summarySheet.addRow({ metric: 'Total Views', value: totals.view });
      summarySheet.addRow({ metric: 'Total Likes', value: totals.like });
      summarySheet.addRow({ metric: 'Total Comments', value: totals.comment });
      summarySheet.addRow({ metric: 'Total Shares', value: totals.share });
      summarySheet.addRow({ metric: 'Total Saves', value: totals.save });
      summarySheet.addRow({ metric: 'Average ER', value: averageER });

      // Add follower data
      if (followerChange.start !== null) {
        summarySheet.addRow({ metric: 'Follower Start', value: followerChange.start });
        summarySheet.addRow({ metric: 'Follower End', value: followerChange.end });
        summarySheet.addRow({ metric: 'Follower Change', value: followerChange.diff, change_pct: followerChange.pct });
      }

      // Add metric changes
      if (metricChange.view.start !== null) {
        summarySheet.addRow({ metric: 'View Change', value: metricChange.view.diff, change_pct: metricChange.view.pct });
        summarySheet.addRow({ metric: 'Like Change', value: metricChange.like.diff, change_pct: metricChange.like.pct });
        summarySheet.addRow({ metric: 'Comment Change', value: metricChange.comment.diff, change_pct: metricChange.comment.pct });
        summarySheet.addRow({ metric: 'Share Change', value: metricChange.share.diff, change_pct: metricChange.share.pct });
        summarySheet.addRow({ metric: 'Save Change', value: metricChange.save.diff, change_pct: metricChange.save.pct });
      }

      // Style summary sheet
      summarySheet.getRow(1).font = { bold: true };
      summarySheet.getRow(1).alignment = { horizontal: 'center' };
      summarySheet.getColumn('B').numFmt = '#,##0';
      summarySheet.getColumn('C').numFmt = '#,##0';
      summarySheet.getColumn('D').numFmt = '0.00%';

      // WORKSHEET 3: Monthly Data (for comparison mode)
      if (isCompare && monthlyData.length > 0) {
        const monthlySheet = workbook.addWorksheet('Monthly Analysis');
        monthlySheet.columns = [
          { header: 'Month', key: 'month', width: 20 },
          { header: 'Posts', key: 'posts', width: 10 },
          { header: 'Views', key: 'views', width: 10 },
          { header: 'Likes', key: 'likes', width: 10 },
          { header: 'Comments', key: 'comments', width: 10 },
          { header: 'Shares', key: 'shares', width: 10 },
          { header: 'Saves', key: 'saves', width: 10 },
          { header: 'Followers', key: 'followers', width: 12 },
          { header: 'Avg ER', key: 'avg_er', width: 10 }
        ];

        monthlyData.forEach(month => {
          monthlySheet.addRow({
            month: month.monthName,
            posts: month.postCount,
            views: month.totals.view,
            likes: month.totals.like,
            comments: month.totals.comment,
            shares: month.totals.share,
            saves: month.totals.save,
            followers: month.followerCount,
            avg_er: month.averageER
          });
        });

        // Style monthly sheet
        monthlySheet.getRow(1).font = { bold: true };
        monthlySheet.getRow(1).alignment = { horizontal: 'center' };
        ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
          monthlySheet.getColumn(col).numFmt = '#,##0';
        });
        monthlySheet.getColumn('I').numFmt = '0.00';
      }

      // WORKSHEET 4: Report Info
      const infoSheet = workbook.addWorksheet('Report Info');
      infoSheet.columns = [
        { header: 'Information', key: 'info', width: 20 },
        { header: 'Value', key: 'value', width: 30 }
      ];

      infoSheet.addRow({ info: 'Report Type', value: isCompare ? 'Comparison' : 'Normal' });
      infoSheet.addRow({ info: 'Start Date', value: actualStartDate });
      infoSheet.addRow({ info: 'End Date', value: actualEndDate });
      infoSheet.addRow({ info: 'Generated Date', value: new Date().toLocaleDateString('id-ID') });
      infoSheet.addRow({ info: 'Formula Used', value: currentFormula.engagement_formula });

      if (isCompare) {
        infoSheet.addRow({ info: 'Months Compared', value: months });
        infoSheet.addRow({ info: 'End Month', value: end_month });
      }

      // Style info sheet
      infoSheet.getRow(1).font = { bold: true };
      infoSheet.getRow(1).alignment = { horizontal: 'center' };

      // Write to buffer and send as response
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="report_${actualStartDate}_to_${actualEndDate}.xlsx"`);

      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    if (isCompare && monthlyData.length > 0) {
      // Mode Perbandingan - prepare monthly chart data
      chartData = prepareChartData(null, insights, 'comparison', monthlyData);
      
      // Prepare follower chart data jika ada data follower
      const hasFollowerData = monthlyData.some(m => m.followerCount !== null);
      if (hasFollowerData) {
        followerChartData = prepareFollowerChartData(monthlyData);
      }
    } else if (reports && reports.length > 0) {
      // Mode Normal - prepare per-post chart data
      const sortedReports = reports.slice().sort((a, b) => new Date(a.post_date) - new Date(b.post_date));
      chartData = prepareChartData(sortedReports, insights, 'normal');
    }

    console.log('🎯 Final render data:');
    console.log('- actualStartDate:', actualStartDate);
    console.log('- actualEndDate:', actualEndDate);
    console.log('- totalPostingan:', totalPostingan);
    console.log('- isCompare:', isCompare);
    console.log('- monthlyData length:', monthlyData.length);

    res.render('reports/print_export', {
      title: 'Cetak Report',
      reports,
      start_date: actualStartDate,
      end_date: actualEndDate,
      includeThumbs,
      formatDate,
      insights,
      totals,
      followerChange,
      metricChange,
      averageER,
      totalPostingan,
      isCompare,
      monthlyData,
      compare,
      end_month,
      months,
      chartData: JSON.stringify(chartData),
      followerChartData: JSON.stringify(followerChartData)
    });
  } catch (err) {
    console.error('❌ Error in /print/export:', err);
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
        platform, like_count, comment_count, view_count, share_count, save_count
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
      
      // Get follower count dari tabel followers jika diperlukan
      if (formula.includes('follower')) {
        const followerCount = await getLatestFollowerCount(report.platform);
        formula = formula.replace(/follower/g, followerCount);
      }
      
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
        platform, like_count, comment_count, view_count, share_count, save_count, 
        target_engagement, target_achieved_date
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
      
      // Get follower count dari tabel followers jika diperlukan
      if (formula.includes('follower')) {
        const followerCount = await getLatestFollowerCount(report.platform);
        formula = formula.replace(/follower/g, followerCount);
      }
      
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