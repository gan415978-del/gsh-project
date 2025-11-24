const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

// --- ХРАНИЛИЩЕ (Картинки) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "public/uploads/";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(
      null,
      Date.now() +
        "-" +
        Math.round(Math.random() * 1e9) +
        path.extname(file.originalname)
    );
  },
});
const upload = multer({ storage: storage });

// --- БАЗА ДАННЫХ ---
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "12ahra29power12", // Твой пароль
  database: "gsh_db",
});

db.connect((err) => {
  if (err) console.error("Ошибка БД:", err);
  else console.log("MySQL подключен");
});

app.use(express.static(path.join(__dirname, "public")));

// --- АВТОРИЗАЦИЯ ---
app.post("/api/register", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name)
    return res.status(400).json({ message: "Заполните поля" });

  try {
    const hash = await bcrypt.hash(password, 8);
    db.query(
      "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
      [email, hash, name, "user"],
      (err) => {
        if (err) return res.status(500).json({ message: "Ошибка сервера" });
        res.json({ message: "Успешно" });
      }
    );
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    async (err, results) => {
      if (results.length === 0)
        return res.status(401).json({ message: "Неверные данные" });
      const user = results[0];
      if (!(await bcrypt.compare(password, user.password_hash)))
        return res.status(401).json({ message: "Неверные данные" });
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
      });
    }
  );
});

// --- ЗАГРУЗКА ---
// Одиночная загрузка (для совместимости)
app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Нет файла" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Множественная загрузка (до 15 файлов)
app.post("/api/upload-multiple", upload.array("images", 15), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: "Нет файлов" });
  }
  const urls = req.files.map(file => `/uploads/${file.filename}`);
  res.json({ urls });
});

// --- ПОСТЫ ---
// 1. Получить список постов (Лента)
// --- ИСПРАВЛЕННЫЙ РОУТ ПОЛУЧЕНИЯ ПОСТОВ (БЕЗОПАСНЫЙ) ---
app.get("/api/posts", (req, res) => {
  const { sort, topicId, userId, authorId } = req.query;
  const currentUserId = userId || 0;

  // Проверяем, лайкнул ли текущий пользователь пост и добавил ли в закладки
  let sql = `
      SELECT articles.*,
      users.name as author_name,
      users.avatar_url as author_avatar,
      categories.name as category_name,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = articles.id AND user_id = ?) as is_liked,
      (SELECT COUNT(*) FROM post_bookmarks WHERE post_id = articles.id AND user_id = ?) as is_bookmarked,
      (SELECT COUNT(*) FROM post_bookmarks WHERE post_id = articles.id) as bookmarks_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = articles.id) as comments_count
      FROM articles
      JOIN users ON articles.author_id = users.id
      LEFT JOIN categories ON articles.category_id = categories.id`;

  let conds = [],
    params = [currentUserId, currentUserId];

  if (topicId) {
    conds.push("articles.category_id = ?");
    params.push(topicId);
  } else if (sort === "bookmarks" && userId) {
    conds.push("articles.id IN (SELECT post_id FROM post_bookmarks WHERE user_id = ?)");
    params.push(userId);
  } else if (sort === "feed" && userId) {
    conds.push(`(
        articles.author_id IN (SELECT target_author_id FROM subscriptions WHERE subscriber_id = ?)
        OR
        articles.category_id IN (SELECT target_category_id FROM subscriptions WHERE subscriber_id = ?)
    )`);
    params.push(userId, userId);
  } else if (authorId) {
    conds.push("articles.author_id = ?");
    params.push(authorId);
  }

  if (conds.length) sql += " WHERE " + conds.join(" AND ");

  if (sort === "popular") {
    // Популярность = просмотры + (лайки × 3)
    // Чем больше лайков, тем выше в рейтинге
    sql +=
      " ORDER BY (articles.views + IFNULL(articles.likes_count, 0) * 3) DESC";
  } else {
    sql += " ORDER BY articles.created_at DESC";
  }

  db.query(sql, params, async (err, results) => {
    if (err) {
      console.error("ОШИБКА DB:", err); // Покажет ошибку в консоли сервера, если она есть
      return res.status(500).send(err);
    }

    // Если постов нет, вернем пустой массив
    if (!results || results.length === 0) {
      return res.json([]);
    }

    // Загружаем изображения для каждого поста
    const postsWithImages = await Promise.all(
      results.map((post) => {
        return new Promise((resolve) => {
          db.query(
            "SELECT image_url FROM post_images WHERE post_id = ? ORDER BY display_order ASC",
            [post.id],
            (imgErr, images) => {
              if (imgErr) {
                console.error("Error loading images:", imgErr);
                post.images = [];
              } else {
                post.images = images.map((img) => img.image_url);
              }
              resolve(post);
            }
          );
        });
      })
    );

    res.json(postsWithImages);
  });
});

// Получить изображения для конкретного поста
app.get("/api/posts/:id/images", (req, res) => {
  db.query(
    "SELECT image_url FROM post_images WHERE post_id = ? ORDER BY display_order ASC",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).send(err);
      res.json(results || []);
    }
  );
});

app.get("/api/posts/single/:id", (req, res) => {
  const userId = req.query.userId || null;

  const sql = `
    SELECT a.*,
      u.name AS author_name,
      u.avatar_url AS author_avatar,
      c.name AS category_name,
      ${userId ? `(SELECT COUNT(*) FROM post_likes WHERE post_id = a.id AND user_id = ${db.escape(userId)}) as is_liked` : '0 as is_liked'},
      ${userId ? `(SELECT COUNT(*) FROM post_bookmarks WHERE post_id = a.id AND user_id = ${db.escape(userId)}) as is_bookmarked` : '0 as is_bookmarked'},
      (SELECT COUNT(*) FROM post_bookmarks WHERE post_id = a.id) as bookmarks_count
    FROM articles a
    LEFT JOIN users u ON a.author_id = u.id
    LEFT JOIN categories c ON a.category_id = c.id
    WHERE a.id = ?`;

  db.query(sql, [req.params.id], (err, r) => {
    if (err) {
      console.error("SQL Error in /api/posts/single/:id:", err);
      return res.status(500).json({ error: err.message });
    }
    if (!r[0]) return res.json({});

    // Получаем изображения для этого поста
    db.query(
      "SELECT image_url FROM post_images WHERE post_id = ? ORDER BY display_order ASC",
      [req.params.id],
      (imgErr, images) => {
        if (imgErr) {
          console.error("SQL Error loading images:", imgErr);
          return res.status(500).json({ error: imgErr.message });
        }
        const post = r[0];
        post.images = images.map(img => img.image_url);
        res.json(post);
      }
    );
  });
});

app.post("/api/posts/create", (req, res) => {
  const { title, content, author_id, category_id, images } = req.body;

  // Создаём пост
  db.query(
    "INSERT INTO articles (title, slug, content, author_id, category_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
    [title, "post-" + Date.now(), content, author_id, category_id],
    (err, result) => {
      if (err) return res.status(500).json(err);

      const postId = result.insertId;

      // Если есть изображения, добавляем их
      if (images && images.length > 0) {
        const values = images.slice(0, 15).map((url, index) => [postId, url, index]);
        const sql = "INSERT INTO post_images (post_id, image_url, display_order) VALUES ?";

        db.query(sql, [values], (imgErr) => {
          if (imgErr) return res.status(500).json(imgErr);
          res.json({ message: "OK", postId });
        });
      } else {
        res.json({ message: "OK", postId });
      }
    }
  );
});

app.put("/api/posts/:id", (req, res) => {
  const { title, content, category_id, images } = req.body;
  const postId = req.params.id;

  // Обновляем пост
  db.query(
    "UPDATE articles SET title=?, content=?, category_id=? WHERE id=?",
    [title, content, category_id, postId],
    (err) => {
      if (err) return res.status(500).json(err);

      // Удаляем старые изображения
      db.query("DELETE FROM post_images WHERE post_id=?", [postId], (delErr) => {
        if (delErr) return res.status(500).json(delErr);

        // Добавляем новые изображения (если есть)
        if (images && images.length > 0) {
          const values = images.slice(0, 15).map((url, index) => [postId, url, index]);
          db.query("INSERT INTO post_images (post_id, image_url, display_order) VALUES ?", [values], (imgErr) => {
            if (imgErr) return res.status(500).json(imgErr);
            res.json({ message: "OK" });
          });
        } else {
          res.json({ message: "OK" });
        }
      });
    }
  );
});

// Частичное обновление поста (только content)
app.patch("/api/posts/:id", (req, res) => {
  const { content, userId } = req.body;
  const postId = req.params.id;

  // Проверяем права доступа
  db.query(
    "SELECT author_id FROM articles WHERE id=?",
    [postId],
    (err, results) => {
      if (err) return res.status(500).json({ message: "Ошибка сервера" });
      if (results.length === 0) return res.status(404).json({ message: "Пост не найден" });

      const post = results[0];

      // Проверяем, является ли пользователь автором или админом
      db.query("SELECT role FROM users WHERE id=?", [userId], (err, userResults) => {
        if (err) return res.status(500).json({ message: "Ошибка сервера" });
        if (userResults.length === 0) return res.status(403).json({ message: "Доступ запрещён" });

        const userRole = userResults[0].role;
        const isOwner = post.author_id === userId;
        const isAdmin = userRole === "admin";

        if (!isOwner && !isAdmin) {
          return res.status(403).json({ message: "Доступ запрещён" });
        }

        // Обновляем content поста
        db.query(
          "UPDATE articles SET content=? WHERE id=?",
          [content, postId],
          (err) => {
            if (err) return res.status(500).json({ message: "Ошибка обновления" });
            res.json({ message: "OK" });
          }
        );
      });
    }
  );
});

app.delete("/api/posts/:id", (req, res) => {
  db.query("DELETE FROM articles WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "OK" });
  });
});

// Увеличить счетчик просмотров
app.post("/api/posts/:id/view", (req, res) => {
  db.query(
    "UPDATE articles SET views = views + 1 WHERE id = ?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "OK" });
    }
  );
});

// --- ПОЛЬЗОВАТЕЛИ ---
app.put("/api/users/:id", (req, res) => {
  const userId = req.params.id;
  const { name, avatar_url, cover_url, status } = req.body;

  let sql = "UPDATE users SET ";
  let params = [];
  let updates = [];

  if (name) {
    updates.push("name = ?");
    params.push(name);
  }
  if (avatar_url !== undefined) {
    updates.push("avatar_url = ?");
    params.push(avatar_url);
  }
  if (cover_url !== undefined) {
    updates.push("cover_url = ?");
    params.push(cover_url);
  }
  if (status !== undefined) {
    updates.push("status = ?");
    params.push(status);
  }

  if (updates.length === 0) return res.json({ message: "Нет данных" });

  sql += updates.join(", ") + " WHERE id = ?";
  params.push(userId);

  db.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ error: err });

    // Возвращаем обновленного юзера
    db.query("SELECT * FROM users WHERE id = ?", [userId], (e, r) => {
      const user = r[0];
      delete user.password_hash; // Не шлем пароль
      res.json({ message: "Updated", user: user });
    });
  });
});

// === ПОЛУЧЕНИЕ ДАННЫХ ПОЛЬЗОВАТЕЛЯ (С ПОДСЧЕТОМ ПОДПИСОК) ===
app.get("/api/users/:id", (req, res) => {
  const userId = req.params.id;
  // Добавляем followers_count и following_count
  // following_count считает только подписки на ЛЮДЕЙ (target_author_id IS NOT NULL)
  const sql = `
        SELECT
            users.id, users.name, users.avatar_url, users.cover_url, users.status, users.role, users.created_at,
            (SELECT COUNT(*) FROM articles WHERE author_id = users.id) as posts_count,
            (SELECT COUNT(*) FROM subscriptions WHERE target_author_id = users.id) as followers_count,
            (SELECT COUNT(*) FROM subscriptions WHERE subscriber_id = users.id AND target_author_id IS NOT NULL) as following_count,
            (SELECT COUNT(*) FROM comments c JOIN articles a ON c.post_id = a.id WHERE c.user_id = users.id AND a.author_id = users.id) as comments_count
        FROM users
        WHERE users.id = ?
    `;
  db.query(sql, [userId], (err, result) => {
    if (err) return res.status(500).json({ error: err });
    res.json(result[0] || {});
  });
});

app.get("/api/top-users", (req, res) => {
  const sql = `
        SELECT 
            users.id, 
            users.name, 
            users.avatar_url, 
            (SELECT COUNT(*) FROM subscriptions WHERE target_author_id = users.id) as followers_count
        FROM users 
        ORDER BY followers_count DESC 
        LIMIT 5
    `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results || []);
  });
});

// --- ПОДПИСКИ (ОБНОВЛЕНО: ЛЮДИ + ТЕМЫ) ---
app.post("/api/subscribe", (req, res) => {
  const { subscriber_id, target_id, type } = req.body; // type: 'author' или 'topic'

  let queryCheck, queryDel, queryIns, params;

  if (type === "topic") {
    queryCheck =
      "SELECT * FROM subscriptions WHERE subscriber_id=? AND target_category_id=?";
    queryDel =
      "DELETE FROM subscriptions WHERE subscriber_id=? AND target_category_id=?";
    queryIns =
      "INSERT INTO subscriptions (subscriber_id, target_category_id) VALUES (?, ?)";
  } else {
    queryCheck =
      "SELECT * FROM subscriptions WHERE subscriber_id=? AND target_author_id=?";
    queryDel =
      "DELETE FROM subscriptions WHERE subscriber_id=? AND target_author_id=?";
    queryIns =
      "INSERT INTO subscriptions (subscriber_id, target_author_id) VALUES (?, ?)";
  }

  params = [subscriber_id, target_id];

  db.query(queryCheck, params, (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length > 0) {
      db.query(queryDel, params, () => res.json({ status: "unsubscribed" }));
    } else {
      db.query(queryIns, params, () => res.json({ status: "subscribed" }));
    }
  });
});

app.get("/api/check-subscription", (req, res) => {
  const { subscriber_id, target_id, type } = req.query;
  if (!subscriber_id || !target_id) return res.json({ isSubscribed: false });

  let sql;
  if (type === "topic") {
    sql =
      "SELECT * FROM subscriptions WHERE subscriber_id=? AND target_category_id=?";
  } else {
    sql =
      "SELECT * FROM subscriptions WHERE subscriber_id=? AND target_author_id=?";
  }

  db.query(sql, [subscriber_id, target_id], (err, r) => {
    res.json({ isSubscribed: r && r.length > 0 });
  });
});

// --- СООБЩЕНИЯ ---
app.post("/api/messages", (req, res) => {
  const { sender_id, receiver_id, content } = req.body;
  db.query(
    "INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (?, ?, ?, NOW())",
    [sender_id, receiver_id, content],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "OK" });
    }
  );
});
app.get("/api/messages/:userId", (req, res) => {
  const { myId } = req.query;
  db.query(
    "SELECT * FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at ASC",
    [myId, req.params.userId, req.params.userId, myId],
    (e, r) => res.json(r || [])
  );
});
// Получить список диалогов с последним сообщением
app.get("/api/conversations", (req, res) => {
  const { userId } = req.query;

  // Этот запрос делает следующее:
  // 1. Находит всех, с кем ты переписывался.
  // 2. Для каждого находит текст последнего сообщения (last_msg).
  // 3. Находит время последнего сообщения (last_date).
  // 4. Сортирует список: самые свежие переписки сверху.

  const sql = `
        SELECT 
            u.id AS partner_id,
            u.name,
            u.avatar_url,
            (
                SELECT content 
                FROM messages m 
                WHERE (m.sender_id = ? AND m.receiver_id = u.id) 
                   OR (m.sender_id = u.id AND m.receiver_id = ?)
                ORDER BY m.created_at DESC 
                LIMIT 1
            ) as last_msg,
            (
                SELECT created_at 
                FROM messages m2 
                WHERE (m2.sender_id = ? AND m2.receiver_id = u.id) 
                   OR (m2.sender_id = u.id AND m2.receiver_id = ?)
                ORDER BY m2.created_at DESC 
                LIMIT 1
            ) as last_date
        FROM users u
        WHERE u.id IN (
            SELECT receiver_id FROM messages WHERE sender_id = ?
            UNION
            SELECT sender_id FROM messages WHERE receiver_id = ?
        )
        ORDER BY last_date DESC
    `;

  // Мы передаем userId 6 раз, так как в запросе 6 знаков вопроса
  db.query(
    sql,
    [userId, userId, userId, userId, userId, userId],
    (err, results) => {
      if (err) return res.status(500).json({ error: err });
      res.json(results || []);
    }
  );
});

// --- УВЕДОМЛЕНИЯ ---
app.get("/api/notifications", (req, res) => {
  if (!req.query.userId) return res.json([]);
  db.query(
    "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 10",
    [req.query.userId],
    (e, r) => res.json(r || [])
  );
});

// --- ТЕМЫ (ОБНОВЛЕНО: С ПОДСЧЕТОМ ПОДПИСЧИКОВ) ---
app.get("/api/categories/:id", (req, res) => {
  const topicId = req.params.id;
  const sql = `
        SELECT c.*, 
        (SELECT COUNT(*) FROM subscriptions WHERE target_category_id = c.id) as subs_count 
        FROM categories c 
        WHERE c.id = ?
    `;
  db.query(sql, [topicId], (e, r) => {
    if (e) return res.status(500).send(e);
    res.json(r[0] || {});
  });
});

// --- НОВАЯ СИСТЕМА ЛАЙКОВ ---
// Поставить/убрать лайк
app.post("/api/posts/:id/like", (req, res) => {
  const postId = req.params.id;
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ message: "Не указан userId" });

  // Проверяем, есть ли уже лайк от этого пользователя
  db.query(
    "SELECT * FROM post_likes WHERE user_id=? AND post_id=?",
    [userId, postId],
    (err, results) => {
      if (err) return res.status(500).json(err);

      if (results.length > 0) {
        // Лайк уже есть -> Удаляем (Toggle Off)
        db.query(
          "DELETE FROM post_likes WHERE user_id=? AND post_id=?",
          [userId, postId],
          (deleteErr) => {
            if (deleteErr) return res.status(500).json(deleteErr);

            // Уменьшаем счетчик
            db.query(
              "UPDATE articles SET likes_count = GREATEST(likes_count - 1, 0) WHERE id=?",
              [postId],
              (updateErr) => {
                if (updateErr) return res.status(500).json(updateErr);

                // Получаем актуальный счетчик
                db.query(
                  "SELECT likes_count FROM articles WHERE id=?",
                  [postId],
                  (selectErr, results) => {
                    if (selectErr) return res.status(500).json(selectErr);
                    const likesCount = results[0]?.likes_count || 0;
                    res.json({ status: "removed", liked: false, likesCount });
                  }
                );
              }
            );
          }
        );
      } else {
        // Лайка нет -> Добавляем
        db.query(
          "INSERT INTO post_likes (user_id, post_id) VALUES (?, ?)",
          [userId, postId],
          (insertErr) => {
            if (insertErr) return res.status(500).json(insertErr);

            // Увеличиваем счетчик
            db.query(
              "UPDATE articles SET likes_count = likes_count + 1 WHERE id=?",
              [postId],
              (updateErr) => {
                if (updateErr) return res.status(500).json(updateErr);

                // Получаем актуальный счетчик
                db.query(
                  "SELECT likes_count FROM articles WHERE id=?",
                  [postId],
                  (selectErr, results) => {
                    if (selectErr) return res.status(500).json(selectErr);
                    const likesCount = results[0]?.likes_count || 0;
                    res.json({ status: "added", liked: true, likesCount });
                  }
                );
              }
            );
          }
        );
      }
    }
  );
});

// Переключение закладки (bookmark)
app.post("/api/posts/:id/bookmark", (req, res) => {
  const postId = req.params.id;
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ message: "Не указан userId" });

  // Проверяем, есть ли уже закладка от этого пользователя
  db.query(
    "SELECT * FROM post_bookmarks WHERE user_id=? AND post_id=?",
    [userId, postId],
    (err, results) => {
      if (err) return res.status(500).json(err);

      if (results.length > 0) {
        // Закладка уже есть -> Удаляем (Toggle Off)
        db.query(
          "DELETE FROM post_bookmarks WHERE user_id=? AND post_id=?",
          [userId, postId],
          (deleteErr) => {
            if (deleteErr) return res.status(500).json(deleteErr);

            // Получаем актуальный счетчик закладок
            db.query(
              "SELECT COUNT(*) as count FROM post_bookmarks WHERE post_id=?",
              [postId],
              (countErr, countResults) => {
                if (countErr) return res.status(500).json(countErr);
                const bookmarksCount = countResults[0]?.count || 0;
                res.json({ status: "removed", bookmarked: false, bookmarksCount });
              }
            );
          }
        );
      } else {
        // Закладки нет -> Добавляем
        db.query(
          "INSERT INTO post_bookmarks (user_id, post_id) VALUES (?, ?)",
          [userId, postId],
          (insertErr) => {
            if (insertErr) return res.status(500).json(insertErr);

            // Получаем актуальный счетчик закладок
            db.query(
              "SELECT COUNT(*) as count FROM post_bookmarks WHERE post_id=?",
              [postId],
              (countErr, countResults) => {
                if (countErr) return res.status(500).json(countErr);
                const bookmarksCount = countResults[0]?.count || 0;
                res.json({ status: "added", bookmarked: true, bookmarksCount });
              }
            );
          }
        );
      }
    }
  );
});

// === КОММЕНТАРИИ ===
// Получить комментарии к посту
app.get("/api/posts/:id/comments", (req, res) => {
  const sql = `
        SELECT c.*, u.name as author_name, u.avatar_url
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = ?
        ORDER BY c.created_at ASC`;
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).send(err);
    res.json(result);
  });
});

// Написать комментарий
app.post("/api/comments", (req, res) => {
  const { article_id, author_id, content } = req.body;
  db.query(
    "INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, NOW())",
    [article_id, author_id, content],
    (err) => {
      if (err) return res.status(500).send(err);
      res.json({ message: "Comment added" });
    }
  );
});

// Редактировать комментарий
app.put("/api/comments/:id", (req, res) => {
  const { content, userId } = req.body;
  const commentId = req.params.id;

  // Проверяем, что пользователь - автор комментария
  db.query("SELECT user_id FROM comments WHERE id = ?", [commentId], (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length === 0) return res.status(404).json({ message: "Комментарий не найден" });
    if (results[0].user_id !== userId) return res.status(403).json({ message: "Нет прав" });

    // Обновляем
    db.query("UPDATE comments SET content = ? WHERE id = ?", [content, commentId], (updateErr) => {
      if (updateErr) return res.status(500).json(updateErr);
      res.json({ message: "OK" });
    });
  });
});

// Удалить комментарий
app.delete("/api/comments/:id", (req, res) => {
  const commentId = req.params.id;
  const { userId } = req.body;

  // Проверяем права
  db.query("SELECT user_id FROM comments WHERE id = ?", [commentId], (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length === 0) return res.status(404).json({ message: "Комментарий не найден" });
    if (results[0].user_id !== userId) return res.status(403).json({ message: "Нет прав" });

    // Удаляем
    db.query("DELETE FROM comments WHERE id = ?", [commentId], (delErr) => {
      if (delErr) return res.status(500).json(delErr);
      res.json({ message: "OK" });
    });
  });
});

// Получить все комментарии пользователя (только его комментарии под его постами)
app.get("/api/users/:userId/comments", (req, res) => {
  const userId = req.params.userId;
  const sort = req.query.sort || "new"; // new или old

  const orderBy = sort === "old" ? "c.created_at ASC" : "c.created_at DESC";

  const sql = `
    SELECT
      c.*,
      u.name as author_name,
      u.avatar_url as author_avatar,
      a.id as post_id,
      a.title as post_title,
      a.author_id as post_author_id
    FROM comments c
    JOIN users u ON c.user_id = u.id
    JOIN articles a ON c.post_id = a.id
    WHERE c.user_id = ? AND a.author_id = ?
    ORDER BY ${orderBy}
  `;

  db.query(sql, [userId, userId], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// === АДМИНКА: УПРАВЛЕНИЕ ТЕМАМИ ===

// 1. Создать тему
app.post("/api/categories", (req, res) => {
  const { name, description } = req.body;
  db.query(
    "INSERT INTO categories (name, description) VALUES (?, ?)",
    [name, description],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Created", id: result.insertId });
    }
  );
});

// 2. Обновить тему (Аватар, Обложка, Описание)
app.put("/api/categories/:id", (req, res) => {
  const { name, description, avatar_url, cover_url } = req.body;
  let updates = [];
  let params = [];

  if (name) {
    updates.push("name = ?");
    params.push(name);
  }
  if (description) {
    updates.push("description = ?");
    params.push(description);
  }
  if (avatar_url !== undefined) {
    updates.push("avatar_url = ?");
    params.push(avatar_url);
  }
  if (cover_url !== undefined) {
    updates.push("cover_url = ?");
    params.push(cover_url);
  }

  if (updates.length === 0) return res.json({ message: "Нет данных" });

  const sql = `UPDATE categories SET ${updates.join(", ")} WHERE id = ?`;
  params.push(req.params.id);

  db.query(sql, params, (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Updated" });
  });
});

// 3. Удалить тему
app.delete("/api/categories/:id", (req, res) => {
  db.query("DELETE FROM categories WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Deleted" });
  });
});

// 4. Получить все темы (для сайдбара)
app.get("/api/categories", (req, res) => {
  db.query("SELECT * FROM categories", (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

app.listen(3000, () => console.log("Server running on 3000"));
