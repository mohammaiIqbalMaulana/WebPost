// utils/dateHelper.js
function formatDate(dateInput) {
  if (!dateInput) return "";
  
  let date;
  if (dateInput instanceof Date) {
    date = dateInput;
  } else {
    // Parse MySQL date string (YYYY-MM-DD) or other formats
    date = new Date(dateInput);
  }
  
  // Check if date is valid
  if (isNaN(date.getTime())) return "";
  
  // Indonesian day names
  const dayNames = [
    'Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'
  ];
  
  // Indonesian month names
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  
  const dayName = dayNames[date.getDay()];
  const day = date.getDate();
  const monthName = monthNames[date.getMonth()];
  const year = date.getFullYear();
  
  return `${dayName}, ${day} ${monthName} ${year}`;
}

// Alternative function for short date format (DD-MM-YYYY)
function formatDateShort(dateInput) {
  if (!dateInput) return "";
  let dateStr = "";
  if (dateInput instanceof Date) {
    // Convert Date -> YYYY-MM-DD
    const year = dateInput.getFullYear();
    const month = String(dateInput.getMonth() + 1).padStart(2, "0");
    const day = String(dateInput.getDate()).padStart(2, "0");
    dateStr = `${year}-${month}-${day}`;
  } else {
    // Anggap string langsung dari MySQL (YYYY-MM-DD)
    dateStr = String(dateInput);
  }
  const [year, month, day] = dateStr.split("-");
  return `${day}-${month}-${year}`;
}

function formatDateTime(datetimeInput) {
  if (!datetimeInput) return "-";
  const date = new Date(datetimeInput);
  
  // Format: DD/MM/YYYY HH:MM
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

// Additional function for Indonesian datetime format
function formatDateTimeIndonesian(datetimeInput) {
  if (!datetimeInput) return "-";
  
  const date = new Date(datetimeInput);
  
  // Check if date is valid
  if (isNaN(date.getTime())) return "-";
  
  // Indonesian day names
  const dayNames = [
    'Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'
  ];
  
  // Indonesian month names
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  
  const dayName = dayNames[date.getDay()];
  const day = date.getDate();
  const monthName = monthNames[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  
  return `${dayName} ${day} ${monthName} ${year}, ${hours}:${minutes}`;
}

module.exports = { 
  formatDate, 
  formatDateShort, 
  formatDateTime, 
  formatDateTimeIndonesian 
};