require('dotenv').config();
const nodemailer = require('nodemailer');
const crypto = require('crypto'); // Inclus par défaut dans Node.js
const express = require('express');
const mysql = require('mysql2');
const multer = require('multer'); // <--- AJOUTÉ : Pour gérer les fichiers
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURATION MULTER ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, 'uploads/'); },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage: storage });

// ----------------------
// MIDDLEWARES
// ----------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Servir les fichiers HTML et assets
app.use(express.static(__dirname + '/fichierprinc'));
app.use('/img', express.static(__dirname + '/img'));
app.use('/uploads', express.static(__dirname + '/uploads')); // <--- AJOUTÉ : Pour voir les fichiers envoyés

// ----------------------
// ma route page acceuil
// ----------------------
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/fichierprinc/index.html');
});

// ----------------------
// connexion mysql ici
// ----------------------
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: "projet"
});

db.connect((err) => {
  if (err) {
    console.error('❌ Erreur de connexion MySQL :', err);
    return;
  }
  console.log('✅ Connecté à MySQL (base projet)');
});


const transporter = nodemailer.createTransport({
  service: 'gmail', 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


app.post('/forgot-password', (req, res) => {
  const { email } = req.body;

  // 1. vérifier si l'utilisateur existe
  db.query("SELECT * FROM clients WHERE email = ?", [email], (err, results) => {
    if (err) return res.status(500).send("Erreur base de données.");
    if (results.length === 0) return res.status(404).send("Cet email n'existe pas.");

    // 2. créer un token unique et une expiration (1 heure)
    const token = crypto.randomBytes(20).toString('hex');
    const expires = new Date(Date.now() + 3600000); 

    // 3. enregistrer le token en base
    db.query("UPDATE clients SET reset_token = ?, reset_expires = ? WHERE email = ?", 
    [token, expires, email], (err) => {
      
      // 4. envoyer l'email
      const resetLink = `http://192.168.1.63:3000/reset-password.html?token=${token}`;
      
      const mailOptions = {
        from: `"Expert Sabjon Mali" <${process.env.EMAIL_USER}>`, 
        to: email,
        subject: 'Réinitialisation de votre mot de passe',
        html: `
          <div style="font-family: sans-serif; color: #1e213a; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            <h2 style="color: #1e213a; text-align: center;">Réinitialisation de mot de passe</h2>
            <p>Bonjour,</p>
            <p>Vous avez demandé à changer votre mot de passe pour votre espace client <strong>Sabjon Mali</strong>.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${resetLink}" style="background-color: #1e213a; color: #d8c09d; padding: 15px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">CHANGER MON MOT DE PASSE</a>
            </div>
            <p style="font-size: 12px; color: #666; text-align: center;">Ce lien est valable pendant 1 heure.</p>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">Si vous n'êtes pas à l'origine de cette demande, ignorez ce mail.</p>
          </div>
        `
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("❌ Erreur Nodemailer :", error); 
          return res.status(500).send("Erreur lors de l'envoi de l'email.");
        }
        console.log("✅ Email envoyé avec succès : " + info.response);
        res.status(200).send("Email de récupération envoyé ! Vérifiez votre boîte mail.");
      });
    });
  });
});

// ca c'ets la route pour enregistrer le nouveau mot de passe
app.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body;

  const sql = "SELECT * FROM clients WHERE reset_token = ? AND reset_expires > NOW()";
  
  db.query(sql, [token], (err, results) => {
    if (err) return res.status(500).send("Erreur serveur.");
    if (results.length === 0) return res.status(400).send("Le lien est invalide ou a expiré.");

    const updateSql = "UPDATE clients SET password = ?, reset_token = NULL, reset_expires = NULL WHERE reset_token = ?";
    db.query(updateSql, [newPassword, token], (err) => {
      if (err) return res.status(500).send("Erreur lors de la mise à jour.");
      res.status(200).send("Mot de passe modifié avec succès !");
    });
  });
});

// ----------------------
// route pour inscription client
// ----------------------
app.post('/register', (req, res) => {
  const { nom, email, password } = req.body;

  if (!nom || !email || !password) {
    return res.status(400).send("Champs manquants");
  }

  const sql = "INSERT INTO clients (nom, email, password) VALUES (?, ?, ?)";

  db.query(sql, [nom, email, password], (err, result) => {
    if (err) {
      console.error("❌ Erreur SQL :", err);
      return res.status(500).send("Erreur lors de l'inscription");
    }

    console.log("✅ Nouveau client inscrit :", email);
    res.redirect('/loginclient.html');
  });
});

// ----------------------
// route login client
// ----------------------
app.post('/login', (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  const sql = "SELECT * FROM clients WHERE email = ? AND password = ?";
  db.query(sql, [email, password], (err, results) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.redirect('/erreurlogin.html');
    }

    if (results.length === 0) {
      return res.redirect('/erreurlogin.html');
    }

    res.send(`
  <script>
    localStorage.setItem("client_email", "${email}");
    window.location.href = "/cclient.html";
  </script>
`);

  });
});

app.post('/envoyerdemande', (req, res) => {
  const { nom, email, telephone, type_document, message } = req.body;

  const sql = "INSERT INTO demandes (nom, email, telephone, type_document, message) VALUES (?, ?, ?, ?, ?)";

  db.query(sql, [nom, email, telephone, type_document, message], (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.redirect('/erreurlogin.html');
    }

    res.redirect('/merci.html'); 
  });
});

app.post('/envoyermessage', upload.single('document'), (req, res) => {
  const { client_email, message } = req.body;
  // On récupère le fichier s'il y en a un
  const document_url = req.file ? `/uploads/${req.file.filename}` : null;

  // On ajoute document_url dans l'INSERT
  const sql = "INSERT INTO messages (client_email, message, expediteur, document_url) VALUES (?, ?, 'admin', ?)";

  db.query(sql, [client_email, message, document_url], (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.redirect('/erreuradmin.html');
    }
    res.redirect('/cadmin.html');
  });
});

app.get('/api/messages/:email', (req, res) => {
  const email = req.params.email;

  const sql = "SELECT * FROM messages WHERE client_email = ? ORDER BY date_envoi ASC";

  db.query(sql, [email], (err, results) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.json([]);
    }

    res.json(results);
  });
});

// --- ROUTE CLIENTMESSAGE MODIFIÉE ---
app.post('/clientmessage', upload.single('document'), (req, res) => {
  const { client_email, message } = req.body;
  const document_url = req.file ? `/uploads/${req.file.filename}` : null;

  if (!client_email) {
    return res.status(400).send("Email manquant");
  }

  const sql = "INSERT INTO messages (client_email, message, expediteur, document_url) VALUES (?, ?, 'client', ?)";

  db.query(sql, [client_email, message, document_url], (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).send("Erreur serveur");
    }

    res.status(200).send("OK"); // On répond OK pour le script AJAX
  });
});

app.get('/api/messages_clients', (req, res) => {
  const sql = `
    SELECT client_email, MAX(date_envoi) AS last_message
    FROM messages
    GROUP BY client_email
    ORDER BY last_message DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.json([]);
    }
    res.json(results);
  });
});

app.get('/api/demandes', (req, res) => {
  db.query("SELECT * FROM demandes ORDER BY date_envoi DESC", (err, results) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.json([]);
    }
    res.json(results);
  });
});

// ----------------------
// route login admin
// ----------------------
app.post('/loginadmin', (req, res) => {
  const { username, password } = req.body;

  const sql = "SELECT * FROM admin WHERE username = ? AND password = ?";
  db.query(sql, [username, password], (err, results) => {
    if (err) {
      console.error("❌ Erreur SQL :", err);
      return res.status(500).send("Erreur serveur");
    }

    if (results.length === 0) {
      return res.status(401).redirect("./erreurlogin.html")
    }

    console.log("🔐 Connexion ADMIN :", username);
    res.redirect('/cadmin.html'); 
  });
});


// Route pour le moteur de recherche admin (filtre par email ou nom)
app.get('/api/recherche_clients', (req, res) => {
  const search = req.query.q;
  const sql = "SELECT nom, email FROM clients WHERE email LIKE ? OR nom LIKE ? LIMIT 10";
  
  db.query(sql, [`%${search}%`, `%${search}%`], (err, results) => {
    if (err) return res.status(500).json([]);
    res.json(results);
  });
});


// ----------------------
// serveur lancée
// ----------------------
app.listen(port, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${port}`);
});