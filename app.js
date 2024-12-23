  import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
  import fs from 'fs';
  import path from 'path';
  import http from 'http';
  import express from 'express';
  import fileUpload from 'express-fileupload';
  import cors from 'cors';
  import bodyParser from 'body-parser';
  import pino from 'pino'; // Logger pino
  import { exit } from 'process';
  import url from 'url';
  
  const app = express();
  const port = process.env.PORT || 8080;
  const logger = pino(); // Menggunakan pino untuk logging
  
  // Get the current directory of the module (fix for ES module)
  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  // Initialize server
  const server = http.createServer(app);
  
  // Declare sock globally
  let sock = null;

// Enable file upload middleware
app.use(fileUpload({
  createParentPath: true
}));

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Function to connect to WhatsApp and initialize sock
async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');  // Lokasi penyimpanan kredensial
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,  // Mencetak QR ke terminal untuk dipindai
      logger: logger, // Menggunakan logger pino
    });

    // Handle connection status changes
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, isNewLogin, qr, receivedPendingNotifications } = update;

      if (connection === 'open') {
        logger.info('Successfully connected');
        if (isNewLogin) {
          logger.info('This is a new login!');
        }
        if (receivedPendingNotifications) {
          logger.info('Device has received all pending notifications.');
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.error('Connection closed due to:', lastDisconnect?.error);
        logger.info('Reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          connectToWhatsApp(); // Reconnect jika tidak logout
        }
      }

      if (connection === 'connecting' && qr) {
        logger.info('Scan this QR code to login:');
        logger.info(qr);  // QR Code akan dicetak di terminal
      }
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      try {
        if (type === 'notify') {
          const msg = messages[0];
          logger.info('Pesan baru diterima:', msg);

          if (!msg.key.fromMe && msg.message) {
            // Handle specific conversation messages
            if (msg.message.conversation) {
              const conversation = msg.message.conversation.toLowerCase();

              // Jika pesan menyapa bot
              if (['hallo', 'hello', 'halo', 'helo'].includes(conversation)) {
                await sock.sendMessage(msg.key.remoteJid, { text: 'Hallo saya adalah bot.' });
              }

              // Jika pesan berisi "mana file", kirim file PDF dari folder 'KODE-FILE-A'
              if (conversation.includes('mana file')) {
                const groupId = msg.key.remoteJid;
                const folderPath = path.join(__dirname, 'KODE-FILE-A'); // Lokasi folder dalam folder aplikasi

                // Periksa apakah folder ada
                if (fs.existsSync(folderPath)) {
                  // Dapatkan semua file dengan ekstensi .pdf
                  const files = fs
                    .readdirSync(folderPath)
                    .filter((file) => path.extname(file) === '.pdf'); // Hanya memilih file .pdf

                  if (files.length > 0) {
                    // Kirimkan setiap file .pdf yang ditemukan
                    for (const file of files) {
                      const filePath = path.join(folderPath, file);
                      await sock.sendMessage(groupId, {
                        document: fs.createReadStream(filePath), // Mengirimkan dokumen dengan stream
                        mimetype: 'application/pdf', // Mimetype untuk PDF
                        fileName: file, // Nama file yang akan dikirim
                      });
                      logger.info(`File ${file} telah dikirim ke grup ${groupId}`);
                    }
                  } else {
                    logger.info('Tidak ada file .pdf di folder.');
                    await sock.sendMessage(groupId, { text: 'Tidak ada file PDF yang tersedia.' });
                  }
                } else {
                  logger.info('Folder KODE-FILE-A tidak ditemukan.');
                  await sock.sendMessage(groupId, { text: 'Folder file tidak ditemukan.' });
                }
              }
            }
          }

          // Menandai pesan sebagai sudah dibaca
          const key = {
            remoteJid: msg.key.remoteJid, // ID chat
            id: msg.key.id, // ID pesan yang ingin ditandai sebagai dibaca
            participant: msg.key.participant, // ID pengirim pesan (untuk grup)
          };
          await sock.readMessages([key]); // Menandai pesan sebagai sudah dibaca
        }
      } catch (error) {
        logger.error('Error handling incoming message:', error);
      }
    });

    // Handle message receipt updates (e.g., message read status)
    sock.ev.on('message-receipt.update', async (update) => {
      try {
        const { key, userReceipt, timestamp } = update;

        if (userReceipt === 'read') {
          logger.info(
            `Message with ID ${key.id} was read at ${new Date(
              timestamp * 1000
            ).toLocaleString()}`
          );
        }
      } catch (error) {
        logger.error('Error handling message receipt update:', error);
      }
    });

  } catch (error) {
    logger.error('Error in WhatsApp connection:', error);
  }
}

// Initialize WhatsApp connection
connectToWhatsApp().catch((err) => logger.error('unexpected error:', err));

// Start the server
server.listen(port, () => {
  logger.info('Server berjalan pada port:', port);
});


 // Function to handle file requests
 async function handleFileRequest(msg) {
  const groupId = msg.key.remoteJid;
  const folderPath = path.join(__dirname, 'KODE-FILE-A'); // Folder containing .vcf files

  try {
    if (fs.existsSync(folderPath)) {
      const files = fs.readdirSync(folderPath).filter(file => path.extname(file) === '.vcf');
      if (files.length > 0) {
        for (const file of files) {
          const filePath = path.join(folderPath, file);
          try {
            await sock.sendMessage(groupId, {
              document: { url: filePath },
              mimetype: 'text/x-vcard',
              fileName: file,
            });
            log2.info(`File ${file} telah dikirim ke grup ${groupId}`);
          } catch (sendError) {
            log2.error(`Gagal mengirim file ${file}: ${sendError.message}`);
            await sock.sendMessage(groupId, { text: `Gagal mengirim file ${file}.` });
          }
        }
      } else {
        log2.info('Tidak ada file .vcf di folder.');
        await sock.sendMessage(groupId, { text: 'Tidak ada file VCF yang tersedia.' });
      }
    } else {
      log2.info('Folder KODE-FILE-A tidak ditemukan.');
      await sock.sendMessage(groupId, { text: 'Folder file tidak ditemukan.' });
    }
  } catch (folderError) {
    log2.error(`Gagal membaca folder KODE-FILE-A: ${folderError.message}`);
    await sock.sendMessage(groupId, { text: 'Terjadi kesalahan saat membaca folder.' });
  }
}
