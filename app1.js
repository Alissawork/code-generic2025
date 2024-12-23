// Import necessary modules
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    BufferJSON, 
    isJidBroadcast, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore, 
    Browsers 
  } from '@whiskeysockets/baileys';
  import fs from 'fs';
  import path from 'path';
  import http from 'http';
  import express from 'express';
  import fileUpload from 'express-fileupload';
  import cors from 'cors';
  import bodyParser from 'body-parser';
  import c from 'ansi-colors';
  import excel from 'exceljs';
  import { exit } from 'process';
  import url from 'url';
  import pino from 'pino'; // Logger for Baileys
  import pinoPretty from 'pino-pretty'; // Pretty print for logs
  import dns from 'dns'; // Untuk memeriksa koneksi internet
  import chalk from 'chalk';
  
  // Initialize app and configurations
  const app = express();
  const workbook = new excel.Workbook();
  const PORT = process.env.PORT || 3000;
  
  // Get the current directory of the module (fix for ES module)
  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  // Declare global socket and store
  let sock = null;
  const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });
  
  // Logger setup
  const prettyStream = pinoPretty({
    colorize: true, 
    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', 
  });
  
  const log2 = pino(
    { level: 'info' },
    prettyStream
  );
  
  const log1 = pino(
    pinoPretty({
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      errorLikeObjectKeys: [], // Pastikan properti error tidak mengubah encoding
    })
  );
  
  // Enable file upload
  app.use(fileUpload({ createParentPath: true }));
  app.use(cors());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  
  // Create HTTP server
  const server = http.createServer(app);
  
  // Function to connect to WhatsApp and initialize socket
  async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys'); // Auth state location
    const { version, isLatest } = await fetchLatestBaileysVersion();
  
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: "silent" }),
      version,
      shouldIgnoreJid: jid => isJidBroadcast(jid),
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {},
                },
                ...message,
              },
            },
          };
        }
        return message;
      },
      browser: ['Chrome', 'Desktop', '131.0.6778.109'], // Format array untuk Chrome Desktop
      syncFullHistory: false,
      // browser: Browsers.macOS('Desktop'),
      // syncFullHistory: false,
    });
  
    store.bind(sock.ev);
    sock.multi = true;
  
    // Perbarui event handler untuk `connection.update`
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        await handleDisconnectReason(reason);
      } else if (connection === 'open') {
        console.log(` WhatsApp ⚡${ c.white.bold.bgGreen('Berhasil Terhubung Ke SERVER ')} pada ${new Date().toLocaleString()}`);
      }
    });
  
    sock.ev.on('creds.update', saveCreds);
  
    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      let msg = null; // Deklarasikan `msg` di luar try-catch
      try {
          if (type === 'notify') {
              msg = messages[0]; // Pesan pertama dari batch
              await sock.readMessages([msg.key]); // Tandai pesan sebagai sudah dibaca
              console.log(
                  c.red.bold('----------------------------------------')
              );
              console.log(
                  c.yellow.bold(`[${new Date().toLocaleString()}]`) + ' ' + c.green.bold('INFO')
              );
              console.log(
                  c.white(`📩 Pesan Baru dari `) + c.green(`${msg.key.remoteJid}`)
              );
              console.log(
                  c.white(`isi pesan: `) +
                  c.blueBright(`${msg.message.conversation || '[No Text]'}`)
              ); 
  
              // Cek apakah msg dan msg.key valid
              if (msg && msg.key && msg.key.remoteJid && msg.message) {
                  const conversation = msg.message.conversation
                      ? msg.message.conversation.toLowerCase()
                      : '';
  
                  // Menangani sapaan
                  if (['hallo', 'hello', 'halo', 'helo'].includes(conversation)) {
                      await sock.sendMessage(msg.key.remoteJid, { text: '🤖 Hallo, saya adalah bot.' });
                      await sock.readMessages([msg.key]); // Tandai pesan sebagai sudah dibaca
                      return;
                  }
  
                  // Tangani pesan yang diawali dengan '#'
                  if (conversation.startsWith('#')) {
                      await handleHashPrefixedFileRequest(msg);
                      await sock.readMessages([msg.key]); // Tandai pesan sebagai sudah dibaca
                      return;
                  }
  
                  if (conversation.startsWith('*cek-kode-ysm')) {
                      const fileList = await getFileList('KODE-FILE-A', 'Kode-YSM-Nisa');
                      await sock.sendMessage(msg.key.remoteJid, { text: fileList });
                      await sock.readMessages([msg.key]);
                      return;
                  }
  
                  if (conversation.startsWith('*cek-kode-yrla')) {
                      const fileList = await getFileList('KODE-FILE-A', 'Kode-YRLA-Noni');
                      await sock.sendMessage(msg.key.remoteJid, { text: fileList });
                      await sock.readMessages([msg.key]);
                      return;
                  }
                  if (conversation.startsWith('*cek-kode-ygis')) {
                    const fileList = await getFileList('KODE-FILE-A', 'Kode-YRLA-Santi');
                    await sock.sendMessage(msg.key.remoteJid, { text: fileList });
                    await sock.readMessages([msg.key]);
                    return;
                }
              }
          }
      } catch (error) {
          log2.error('Error handling incoming message:', error);
  
          if (msg && msg.key && msg.key.remoteJid) {
              // Kirim pesan kesalahan kepada pengguna jika error terjadi
              await sock.sendMessage(msg.key.remoteJid, { text: 'Terjadi kesalahan saat memproses pesan Anda. Mohon coba lagi.' });
          }
      }}
    )};
    
    // Fungsi untuk memeriksa koneksi internet
    async function checkInternetConnection() {
      return new Promise((resolve) => {
        dns.lookup('google.com', (err) => {
          resolve(!err); // True jika tidak ada error (terhubung ke internet)
        });
      });
    }

    // Fungsi utama untuk reconnecting dengan pemeriksaan koneksi
    async function reconnectWithCheck() {
      log2.info('Memulai proses reconnecting...');

      const isConnected = await checkInternetConnection();
      if (!isConnected) {
        log2.error('Tidak ada koneksi internet. Proses dihentikan.');
        process.exit(1); // Menghentikan terminal
      }

      log2.info('Koneksi internet tersedia. Melanjutkan reconnect...');
      try {
        // Tutup koneksi lama jika ada
        if (sock) {
          sock.end(); // Mengakhiri koneksi sebelumnya
          log2.info('Koneksi lama ditutup.');
        }

        // Membuat koneksi baru
        await connectToWhatsApp();
        log2.info('Reconnecting berhasil.');
      } catch (error) {
        log2.error(`Gagal reconnecting: ${error.message}`);
        process.exit(1); // Hentikan jika reconnect gagal
      }
    }

  // Perbarui event handler untuk menangani status koneksi
    async function handleDisconnectReason(reason) {
      switch (reason) {
        case DisconnectReason.badSession:
          log2.error('File Sesi Buruk, Harap Hapus auth_info_baileys dan Pindai Lagi');
          sock.logout();
          break;
        case DisconnectReason.connectionClosed:
          log2.info('Sambungan ditutup, sambungkan kembali....');
          await reconnectWithCheck();
          break;
        case DisconnectReason.connectionLost:
          log2.info('Koneksi Hilang dari Server, menyambung kembali...');
          await reconnectWithCheck();
          break;
        case DisconnectReason.connectionReplaced:
          log2.error('Koneksi Diganti, Sesi Baru Lagi Dibuka, Harap Tutup Sesi Saat Ini Terlebih Dahulu');
          sock.logout();
          break;
        case DisconnectReason.loggedOut:
          log2.error('Perangkat Keluar, Harap Hapus auth_info_baileys dan Pindai Lagi.');
          sock.logout();
          break;
        case DisconnectReason.restartRequired:
          log2.info('Diperlukan Mulai Ulang, Mulai Ulang...');
          await reconnectWithCheck();
          break;
        case DisconnectReason.timedOut:
          log2.info('Waktu Sambungan Habis, Menyambungkan Kembali...');
          await reconnectWithCheck();
          break;
        default:
          log2.error(`Alasan Pemutusan Tidak Diketahui: ${reason}`);
          sock.end();
      }
    }

    // Function to handle file requests with specific format
    async function handleHashPrefixedFileRequest(msg) {
      const groupId = msg.key.remoteJid; // ID grup pengirim pesan
      const folderPathA = path.join(__dirname, 'KODE-FILE-A'); // Path ke folder KODE-FILE-A
      const folderPathB = path.join(__dirname, 'KODE-FILE-B'); // Path ke folder KODE-FILE-B
    
      try {
        // Periksa apakah folder KODE-FILE-A ada
        if (fs.existsSync(folderPathA)) {
          const files = fs.readdirSync(folderPathA).filter(file => path.extname(file) === '.vcf'); // Filter file .vcf
    
          // Ambil percakapan dari pesan
          const conversation = msg.message.conversation ? msg.message.conversation.trim() : '';
          if (!conversation.startsWith('#')) return; // Hanya proses pesan yang diawali '#'
  
          // Validasi format pesan
          //const regex = /^#(ysm|yrla)\/[a-z]+\/[a-z]+\/[0-9]+$/i; // Contoh regex untuk validasi pesan seperti #YSM/Noni/A/001 atau #YRLA/Noni/A/001
          const regex = /^#(ysm|yrla|ygis)\/[a-z]+\/[0-9]+$/i; // Contoh regex untuk validasi pesan seperti #YSM/Noni/A/001 atau #YRLA/Noni/A/001
          if (!regex.test(conversation)) {
            await sock.sendMessage(groupId, { text: '✨ Format kode tidak valid, pastikan ketik kode dengan benar' });
            log2.info('Pesan tidak sesuai format.');
            return;
          }
    
          // Normalisasi input untuk memastikan format seragam
          const normalizedInput = conversation
            .substring(1) // Hilangkan '#' di awal
            .toLowerCase() // Ubah menjadi huruf kecil
            .replace(/\//g, '-') // Ganti '/' dengan '-'
            .replace(/\bysm\b/gi, 'YSM') // Normalisasi 'ysm' menjadi 'YSM'
            .replace(/\byrla\b/gi, 'YRLA') // Normalisasi 'yrla' menjadi 'YRLA'
            .replace(/\bygis\b/gi, 'YGIS'); // Normalisasi 'yrla' menjadi 'YRLA'
  
          // Format input menjadi nama file dengan prefiks "Kode-"
          const formattedFileName = 'Kode-' + normalizedInput
            .split('-') // Pecah berdasarkan '-'
            .map(part => part.charAt(0).toUpperCase() + part.slice(1)) // Formatkan setiap bagian menjadi CamelCase
            .join('-') + '-(200).vcf';
    
          // Periksa apakah file dengan nama tersebut ada
          if (files.includes(formattedFileName)) {
            const filePath = path.join(folderPathA, formattedFileName);
            const destinationPath = path.join(folderPathB, formattedFileName);
  
            // Kirim pesan "loading..." sebelum mengirim file
            await sock.sendMessage(groupId, { text: '⏳Loading...' });
  
            // Kirim file yang sesuai
            await sock.sendMessage(groupId, {
              document: { url: filePath },
              mimetype: 'text/x-vcard',
              fileName: formattedFileName,
            });
  
            // Pindahkan file ke folder KODE-FILE-B
            fs.renameSync(filePath, destinationPath);
            log2.info(`File ${formattedFileName} telah dikirim ke grup ${groupId} dan dipindahkan ke ${folderPathB}`);
          } else {
            // Jika file tidak ditemukan
            log2.info(`File ${formattedFileName} tidak ditemukan di folder.`);
            await sock.sendMessage(groupId, { text: `🔍File ${formattedFileName} tidak ditemukan.` });
          }
        } else {
          // Jika folder tidak ditemukan
          log2.info('Folder KODE-FILE-A tidak ditemukan.');
          await sock.sendMessage(groupId, { text: 'ℹ️ Folder file tidak ditemukan.' });
        }
      } catch (error) {
        // Tangani kesalahan saat membaca folder atau mengirim file
        log2.error(`Gagal memproses permintaan file: ${error.message}`);
        await sock.sendMessage(groupId, { text: 'ℹ️ Terjadi kesalahan saat memproses permintaan file.' });
      }
  }

  async function getFileList(folderName, prefix) {
    try {
        const directoryPath = path.join(__dirname, folderName);
        const files = fs.readdirSync(directoryPath);
        const filteredFiles = files.filter(file => file.startsWith(prefix));

        if (filteredFiles.length === 0) {
            return `🗃️ Kode habis, tidak tersedia ${prefix}. Hubungi meyedia kode`;
        }

        return `💾File Kode tersedia:\n` + filteredFiles.map((file, index) => `${index + 1}. ${file}`).join('\n');
    } catch (error) {
        log.error(`Error reading files from folder: ${error}`);
        return `Error reading files from folder: ${folderName}.`;
    }
  }

  // Initialize WhatsApp connection
  connectToWhatsApp().catch(err => log2.error("unexpected error: " + err));
  
  // Start the server
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
  
