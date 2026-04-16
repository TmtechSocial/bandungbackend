const { CmisSession } = require("cmis");
const CMIS_SECRET_URL = process.env.CMIS_SECRET_URL;
require("dotenv").config();
const axios = require("axios");
const sharp = require("sharp");

async function cmisConfigList(fastify, headers) {
  const decodedAuth = Buffer.from(headers, "base64").toString("utf-8");
  console.log("decodedAuth", decodedAuth);
  const [username, password] = decodedAuth.split(":");

  // Verifikasi ke repository CMIS
  const session = new CmisSession(CMIS_SECRET_URL);
  session.setCredentials("admin", "admin");
  try {
    await session.loadRepositories();

    const folderResponse = await session.getObjectByPath("/");
    const childrenResponse = await session.getChildren(
      folderResponse.succinctProperties["cmis:objectId"]
    );

    const documentList = childrenResponse.objects.map((child) => {
      const properties = child.object?.succinctProperties || {};
      return {
        id: properties["cmis:objectId"] || null,
        name: properties["cmis:name"] || "Unnamed Document",
        type: properties["cmis:baseTypeId"] || "Unknown",
        createdBy: properties["cmis:createdBy"] || "Unknown",
        createdDate: properties["cmis:creationDate"] || "Unknown",
      };
    });

    return { message: "Documents retrieved successfully", data: documentList };
  } catch (error) {
    console.error(error);
  }
}
async function cmisConfigView(fastify, headers, id) {
  const decodedAuth = Buffer.from(headers, "base64").toString("utf-8");
  const [username, password] = decodedAuth.split(":");

  // Verifikasi ke repository CMIS
  const session = new CmisSession(CMIS_SECRET_URL);
  session.setCredentials(username, password);

  try {
    await session.loadRepositories();

    const documentResponse = await session.getObject(id);

    const response = await session.getContentStream(id, "inline");

    const arrayBuffer = await response.arrayBuffer();

    // Mengubah konten ke Base64
    const base64Content = Buffer.from(arrayBuffer).toString("base64");

    const data = {
      fileName: documentResponse.succinctProperties["cmis:name"],
      mimeType:
        documentResponse.succinctProperties["cmis:contentStreamMimeType"] ||
        null,
      base64: base64Content,
    };

    return { message: "Documents retrieved successfully", data: data };
  } catch (error) {
    console.error(error);
  }
}

async function cmisConfigUpload(fastify, file) {
  //console.log("headers", headers["cmis-auth"]);
  //const decodedAuth = Buffer.from(headers, "base64").toString("utf-8");
  //const [username, password] = decodedAuth.split(":");
  const credcmis = Buffer.from(`admin:admin`).toString("base64");
  //console.log("username", username);
  //console.log("password", password);

  // Verifikasi ke repository CMIS
  const session = new CmisSession(CMIS_SECRET_URL);
  session.setCredentials("admin", "admin");
  console.log("session", session);

  try {
    const files = [];
    // console.log("file", file);
    
    for await (const data of file) {
      // console.log("data", data);
      let fileBuffer = await data.toBuffer();
      const fileName = data.filename;
      const mimeType = data.mimetype;
      
      // Hanya kompres file gambar (image/*) jika ukurannya > 100KB
      if (mimeType && mimeType.startsWith('image/') && fileBuffer.length > 100000) {
        try {
          console.log(`🖼️ Mengkompresi gambar: ${fileName} (${mimeType}) - Size: ${(fileBuffer.length/1024).toFixed(2)}KB`);
          
          const sharpInstance = sharp(fileBuffer);
          
          // Resize jika gambar terlalu besar (max width 1920px untuk performa)
          const metadata = await sharpInstance.metadata();
          if (metadata.width > 1920) {
            sharpInstance.resize(1920, null, { 
              withoutEnlargement: true,
              fastShrinkOnLoad: true 
            });
          }
          
          // Kompresi berdasarkan format asli
          if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
            fileBuffer = await sharpInstance
              .jpeg({ 
                quality: 60, 
                progressive: true,
                mozjpeg: true 
              })
              .toBuffer();
          } else if (mimeType.includes('png')) {
            fileBuffer = await sharpInstance
              .png({ 
                quality: 60,
                compressionLevel: 9,
                progressive: true
              })
              .toBuffer();
          } else if (mimeType.includes('webp')) {
            fileBuffer = await sharpInstance
              .webp({ quality: 60 })
              .toBuffer();
          } else {
            // Untuk format lain, convert ke JPEG untuk ukuran lebih kecil
            fileBuffer = await sharpInstance
              .jpeg({ quality: 60, progressive: true })
              .toBuffer();
          }
          
          const newSize = (fileBuffer.length/1024).toFixed(2);
          console.log(`✅ Gambar ${fileName} dikompres: ${metadata.width}x${metadata.height} - New size: ${newSize}KB`);
        } catch (compressError) {
          console.log(`⚠️ Gagal mengkompresi ${fileName}, menggunakan file asli:`, compressError.message);
          // Jika gagal kompresi, tetap gunakan buffer asli
        }
      } else if (mimeType && mimeType.startsWith('image/')) {
        console.log(`⚡ Gambar ${fileName} sudah kecil (${(fileBuffer.length/1024).toFixed(2)}KB), skip compression`);
      } else {
        // File bukan gambar - tidak perlu kompresi
        console.log(`📄 File ${fileName} (${mimeType || 'unknown'}) - ${(fileBuffer.length/1024).toFixed(2)}KB - No compression needed`);
      }
      
      // console.log("fileBuffer", fileBuffer);
      // console.log("fileName", fileName);

      // Membentuk form data untuk upload
      const folderId = `/test/root`;
      const form = new FormData();
      form.append("cmisaction", "createDocument");
      form.append("propertyId[0]", "cmis:objectTypeId");
      form.append("propertyValue[0]", "cmis:document");
      form.append("propertyId[1]", "cmis:name");
      form.append("propertyValue[1]", fileName);
      form.append("file", fileBuffer, fileName);

      // Mengirim request ke API CMIS
      const response = await axios.post(`${CMIS_SECRET_URL}${folderId}`, form, {
        headers: {
          Authorization: `Basic ${credcmis}`,
          "Content-Type": "multipart/form-data",
        },
      });

      files.push(response.data);
    }

    // console.log("files", files);
    return {
      message: `All File uploaded successfully`,
      data: files,
    };
  } catch (error) {
    console.error("Error uploading file to CMIS:", error);

    if (error.response) {
      // Jika error dari server CMIS
      return {
        message: `Failed to upload file ${file.filename}`,
        error: error.response.data,
      };
    } else if (error.request) {
      // Jika tidak ada respons dari server
      return {
        message: `No response from CMIS server for file ${file.filename}`,
        error: error.message,
      };
    } else {
      // Error lainnya
      return {
        message: `An unexpected error occurred during file upload`,
        error: error.message,
      };
    }
  }
}

module.exports = {
  cmisConfigList,
  cmisConfigView,
  cmisConfigUpload,
};
