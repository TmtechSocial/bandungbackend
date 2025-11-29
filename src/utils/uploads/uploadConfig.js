const FormData = require("form-data");

async function uploadConfig(headers, files) {
  try {
    // Buat FormData untuk mengirimkan beberapa file
    const formData = new FormData();

    // Iterasi setiap file dan tambahkan ke FormData
    for (const fileData of files) {
      const base64Data = fileData.url; // Base64 string
      const mimeType = fileData.type; // Mime type (e.g., "image/png")
      const name = fileData.name;

      // Convert base64 string ke Buffer
      const fileBuffer = base64ToBuffer(base64Data);

      // Tambahkan file ke FormData dengan nama yang sesuai
      formData.append("files", fileBuffer, { filename: name, contentType: mimeType });
    }

    console.log("files", formData);
    console.log("FormData ready for upload");

    // Setup requestOptions untuk mengirim semua file sekaligus
    const requestOptions = {
      method: "POST",
      body: formData,
      headers: {
        "cmis-auth": "ZW1wbG95ZWU6ZW1wbG95ZWU%3D",
        "Content-Type": "multipart/form-data; boundary=<calculated when request is sent>"
        // Content-Type akan otomatis diatur oleh FormData
      },
    };

    // Kirim permintaan untuk mengupload semua file
    const uploadResponse = await fetch(
      `http://localhost:5000/chemisUpload`,
      requestOptions
    );
    const result = await uploadResponse.text();
    console.log("Batch file upload response:", result);
    return result;
  } catch (error) {
    console.error("Error uploading files:", error.message);
    throw error; // Rethrow untuk penanganan lebih lanjut
  }
}

// Fungsi untuk mengonversi base64 ke Buffer
function base64ToBuffer(base64) {
  // Menghilangkan prefix seperti "data:image/png;base64,"
  const base64String = base64.split(",")[1];
  return Buffer.from(base64String, "base64");
}

module.exports = uploadConfig;
