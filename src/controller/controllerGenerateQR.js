const QRCode = require('qrcode');

async function generateQR(text) {
  try {
    const url = await QRCode.toDataURL(text);
    return url;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

module.exports = {
  generateQR
};