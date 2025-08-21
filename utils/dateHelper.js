// utils/dateHelper.js
function formatDate(dateInput) {
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

module.exports = { formatDate };
