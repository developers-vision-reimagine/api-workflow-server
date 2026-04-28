import crypto from "crypto";

function getPrivateKey() {
  return (process.env.PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

const decryptData = (data) => {
  const privateKey = getPrivateKey();

  try {
    let parsed;

    if (typeof data === "object" && data.key && data.iv && data.data) {
      // Hybrid AES+RSA format
      const encryptedKey = Buffer.from(data.key, "base64");
      const aesKey = crypto.privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        encryptedKey,
      );

      const iv = Buffer.from(data.iv, "base64");
      const encryptedData = Buffer.from(data.data, "base64");

      const tagLength = 16;
      const actualData = encryptedData.slice(0, -tagLength);
      const tag = encryptedData.slice(-tagLength);

      const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(actualData, null, "utf8");
      decrypted += decipher.final("utf8");

      const cleaned = decrypted.replace(/[\x00-\x1F\x7F-\x9F]/g, "");

      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const furtherCleaned = cleaned
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .replace(/\t/g, " ")
          .replace(/\f/g, " ")
          .replace(/\v/g, " ");
        try {
          parsed = JSON.parse(furtherCleaned);
        } catch {
          const jsonMatch = decrypted.match(/\{.*\}/s);
          if (jsonMatch) {
            parsed = JSON.parse(
              jsonMatch[0].replace(/[\x00-\x1F\x7F-\x9F]/g, ""),
            );
          } else {
            throw new Error("No valid JSON found in decrypted data");
          }
        }
      }
    } else {
      // Legacy RSA-only format
      const decrypted = crypto.privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(data, "base64"),
      );

      const cleaned = decrypted.toString().replace(/[\x00-\x1F\x7F-\x9F]/g, "");
      parsed = JSON.parse(cleaned);
    }

    return parsed;
  } catch (err) {
    console.error("Decryption error:", err.message);
    throw new Error("Failed to decrypt data: " + err.message);
  }
};

const isEncrypted = (data) => {
  if (typeof data === "object" && data !== null && data.key && data.iv && data.data) {
    return true;
  }
  if (typeof data === "string" && data.length > 100) {
    try {
      Buffer.from(data, "base64");
      return true;
    } catch {
      return false;
    }
  }
  return false;
};

export function decryptMiddleware(req, res, next) {
  if (!req.body || !isEncrypted(req.body)) return next();
  try {
    req.body = decryptData(req.body);
    if (!req.body) {
      return res.status(400).json({ error: "Invalid encryption" });
    }
    next();
  } catch (err) {
    console.error("Decrypt middleware error:", err.message);
    return res.status(400).json({ error: "Invalid encryption" });
  }
}
