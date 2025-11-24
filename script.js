// Глобальные переменные
let editingPostId = null;
let currentImages = []; // Массив URL загруженных изображений
let currentChatPartnerId = null;
let postToDeleteId = null;
let currentViewingPostId = null;
let commentSortOrder = "old"; // "old" или "new"

document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
  setupGlobalListeners();
  loadSidebarTopics();
  loadTopUsers();
  loadSidebarTopAuthors();
  handleRouting();
  setupBackButton();
  // Временно отключено: if (localStorage.getItem("user")) setInterval(checkNewNotifications, 3000);

  // Обработчик Enter для отправки комментария
  const commentInput = document.getElementById("viewer-comment-input");
  if (commentInput) {
    commentInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendComment();
      }
    });
  }

  // Обработчики меню поста
  const viewerMenuBtn = document.getElementById("viewer-post-menu-btn");
  const viewerMenu = document.getElementById("viewer-post-menu");

  if (viewerMenuBtn && viewerMenu) {
    viewerMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      viewerMenu.classList.toggle("show");
    });

    // Закрытие меню при клике вне его
    document.addEventListener("click", (e) => {
      if (!viewerMenu.contains(e.target) && !viewerMenuBtn.contains(e.target)) {
        viewerMenu.classList.remove("show");
      }
    });
  }

  // Обработчик удаления поста
  const deletePostBtn = document.getElementById("viewer-delete-post");
  if (deletePostBtn) {
    deletePostBtn.addEventListener("click", () => {
      viewerMenu.classList.remove("show");
      const deleteModal = document.getElementById("delete-modal");
      if (deleteModal) {
        postToDeleteId = currentViewingPostId;
        deleteModal.classList.add("open");
      }
    });
  }

  // Обработчик редактирования поста
  const editPostBtn = document.getElementById("viewer-edit-post");
  if (editPostBtn) {
    editPostBtn.addEventListener("click", async () => {
      viewerMenu.classList.remove("show");

      // Закрываем viewer поста
      const postViewer = document.getElementById("post-viewer-modal");
      if (postViewer) {
        postViewer.classList.remove("open");
      }

      // Загружаем данные поста и открываем редактор
      try {
        const res = await fetch(`/api/posts/single/${currentViewingPostId}`);
        const post = await res.json();
        openEditor(post);
      } catch (e) {
        console.error("Ошибка загрузки поста для редактирования:", e);
        alert("Ошибка при загрузке данных поста");
      }
    });
  }
});

// === 1. ГЛОБАЛЬНЫЕ СЛУШАТЕЛИ ===
function setupGlobalListeners() {
  document.body.addEventListener("click", (e) => {
    // Обработка лайков
    const likeBtn = e.target.closest(".action-like");
    if (likeBtn) {
      e.preventDefault();
      e.stopPropagation();

      const postId = likeBtn.getAttribute("data-id");
      toggleLike(postId, likeBtn);
      return;
    }

    // Обработка закладок
    const bookmarkBtn = e.target.closest(".action-bookmark");
    if (bookmarkBtn) {
      e.preventDefault();
      e.stopPropagation();

      const postId = bookmarkBtn.getAttribute("data-id");
      toggleBookmark(postId, bookmarkBtn);
      return;
    }

    // Обработка кнопки "Поделиться"
    const shareBtn = e.target.closest(".action-share");
    if (shareBtn) {
      e.preventDefault();
      e.stopPropagation();

      const postId = shareBtn.getAttribute("data-id");
      const shareMenu = document.getElementById(`share-menu-${postId}`);

      if (shareMenu) {
        // Закрываем все остальные открытые меню
        document.querySelectorAll(".share-menu.active").forEach(menu => {
          if (menu.id !== `share-menu-${postId}`) {
            menu.classList.remove("active");
          }
        });

        // Переключаем текущее меню
        shareMenu.classList.toggle("active");
      }
      return;
    }

    // Обработка опций в меню "Поделиться"
    const shareOption = e.target.closest(".share-option");
    if (shareOption) {
      e.preventDefault();
      e.stopPropagation();

      const action = shareOption.getAttribute("data-action");
      const postId = shareOption.getAttribute("data-id");
      const postUrl = `${window.location.origin}/index.html?post=${postId}`;

      if (action === "telegram") {
        // Открыть Telegram с ссылкой
        window.open(`https://t.me/share/url?url=${encodeURIComponent(postUrl)}`, '_blank');
      } else if (action === "copy") {
        // Копировать ссылку в буфер обмена
        navigator.clipboard.writeText(postUrl).then(() => {
          // Показываем уведомление
          const notification = document.createElement("div");
          notification.className = "copy-notification";
          notification.textContent = "Ссылка скопирована!";
          document.body.appendChild(notification);

          setTimeout(() => {
            notification.classList.add("show");
          }, 10);

          setTimeout(() => {
            notification.classList.remove("show");
            setTimeout(() => notification.remove(), 300);
          }, 2000);
        }).catch(err => {
          console.error("Ошибка копирования:", err);
        });
      }

      // Закрываем меню после выбора
      const shareMenu = document.getElementById(`share-menu-${postId}`);
      if (shareMenu) {
        shareMenu.classList.remove("active");
      }
      return;
    }

    // Закрыть меню "Поделиться" при клике вне его
    if (!e.target.closest(".share-menu") && !e.target.closest(".action-share")) {
      document.querySelectorAll(".share-menu.active").forEach(menu => {
        menu.classList.remove("active");
      });
    }

    // Обработка кнопки "Опубликовать"
    const writeBtn = e.target.closest(".btn-write");
    if (writeBtn) {
      e.preventDefault();
      e.stopPropagation();

      const user = JSON.parse(localStorage.getItem("user"));
      if (!user) {
        document.getElementById("auth-modal")?.classList.add("open");
        return;
      }

      openEditor();
      return;
    }

    // Если кликнули по ссылке в меню
    const navLink = e.target.closest(".nav-item");
    if (navLink) {
      const href = navLink.getAttribute("href");
      // Проверяем, ведет ли ссылка на защищенные страницы
      if (
        href &&
        (href.includes("feed.html") || href.includes("messages.html"))
      ) {
        // Если пользователя нет в памяти -> Отменяем переход и открываем окно
        if (!localStorage.getItem("user")) {
          e.preventDefault(); // <--- Самое важное: запрещает переход по ссылке
          document.getElementById("auth-modal").classList.add("open");
          return;
        }
      }
    }
    const user = JSON.parse(localStorage.getItem("user"));
    const isAdmin = user && user.role === "admin";

    // ---------------------------------------------------------
    // ЛОГИКА ТЕМЫ (ИСПРАВЛЕНО)
    // ---------------------------------------------------------

    // 1. Кнопки внутри меню аватарки темы
    if (e.target.closest("#action-change-topic-avatar")) {
      document.getElementById("input-upload-topic-avatar").click();
      document.getElementById("menu-topic-avatar")?.classList.remove("show");
      return;
    }
    if (e.target.closest("#action-view-topic-avatar")) {
      const src = document.getElementById("topic-avatar").src;
      document.getElementById("viewer-img").src = src;
      document.getElementById("avatar-viewer").classList.add("open");
      document.getElementById("menu-topic-avatar")?.classList.remove("show");
      return;
    }

    // 2. Клик по самой аватарке темы
    if (e.target.closest("#topic-avatar-container")) {
      if (isAdmin) {
        // АДМИН: Открываем меню
        e.stopPropagation();
        const menu = document.getElementById("menu-topic-avatar");
        if (menu) menu.classList.toggle("show");
      } else {
        // ОБЫЧНЫЙ ЮЗЕР: Сразу просмотр
        const src = document.getElementById("topic-avatar").src;
        document.getElementById("viewer-img").src = src;
        document.getElementById("avatar-viewer").classList.add("open");
      }
      return;
    }

    // 3. Остальные кнопки темы
    if (e.target.closest("#admin-add-topic-btn")) {
      document.getElementById("topic-modal-title").innerText = "Новая тема";
      document.getElementById("topic-name-input").value = "";
      document.getElementById("topic-desc-input").value = "";
      document.getElementById("topic-modal").classList.add("open");
      return;
    }
    if (e.target.id === "btn-save-topic") {
      saveTopic();
      return;
    }
    if (e.target.closest("#btn-admin-delete-topic")) {
      deleteTopic();
      return;
    }
    if (e.target.closest("#btn-admin-settings")) {
      const title = document.getElementById("topic-title").innerText;
      const desc = document.getElementById("topic-desc").innerText;
      document.getElementById("topic-modal-title").innerText = "Настройки темы";
      document.getElementById("topic-name-input").value = title;
      document.getElementById("topic-desc-input").value =
        desc === "..." ? "" : desc;
      document.getElementById("topic-modal").classList.add("open");
      return;
    }
    if (e.target.id === "btn-topic-subscribe") {
      const params = new URLSearchParams(window.location.search);
      const topicId = params.get("id");
      if (user) toggleSubscription(user.id, topicId, e.target, "topic");
      else document.getElementById("auth-modal").classList.add("open");
      return;
    }
    if (e.target.closest("#btn-edit-topic-cover")) {
      document.getElementById("input-upload-topic-cover").click();
      return;
    }

    // ---------------------------------------------------------
    // ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
    // ---------------------------------------------------------
    if (e.target.closest("#btn-edit-cover")) {
      e.stopPropagation();
      document.getElementById("menu-cover").classList.toggle("show");
      return;
    }
    if (e.target.closest("#action-change-cover")) {
      document.getElementById("input-upload-cover").click();
      return;
    }
    if (e.target.closest("#action-delete-cover")) {
      deleteCover();
      return;
    }

    if (e.target.closest("#avatar-container")) {
      if (document.getElementById("menu-avatar")) {
        e.stopPropagation();
        document.getElementById("menu-avatar").classList.toggle("show");
      } else {
        openAvatarViewer();
      }
      return;
    }
    if (e.target.closest("#action-change-avatar")) {
      document.getElementById("input-upload-avatar").click();
      return;
    }
    if (e.target.closest("#action-view-avatar")) {
      openAvatarViewer();
      return;
    }
    if (e.target.closest("#avatar-viewer")) {
      document.getElementById("avatar-viewer").classList.remove("open");
      return;
    }

    // Статус и Настройки профиля
    if (e.target.closest("#btn-edit-status")) {
      e.stopPropagation();
      enableStatusEdit();
      return;
    }
    if (e.target.closest("#btn-profile-settings")) {
      e.stopPropagation();
      document.getElementById("menu-settings").classList.toggle("show");
      return;
    }
    if (e.target.closest("#action-change-name")) {
      document.getElementById("menu-settings").classList.remove("show");
      document.getElementById("name-change-modal").classList.add("open");
      return;
    }
    if (e.target.id === "btn-save-name") {
      saveNewName();
      return;
    }

    // ---------------------------------------------------------
    // ОБЩИЕ КНОПКИ И ЛОГИКА
    // ---------------------------------------------------------
    if (e.target.closest(".btn-write") || e.target.closest(".btn-write-new")) {
      e.preventDefault();
      localStorage.getItem("user")
        ? openEditor()
        : document.getElementById("auth-modal").classList.add("open");
      return;
    }
    if (e.target.closest(".btn-login")) {
      document.getElementById("auth-modal").classList.add("open");
      return;
    }

    // Закрытие модалок
    if (
      e.target.closest(".close-editor") ||
      e.target.closest(".close-chat") ||
      e.target.closest(".modal-close") ||
      e.target.closest("#btn-close-viewer")
    ) {
      const modal =
        e.target.closest(".modal-overlay") ||
        document.getElementById("post-viewer-modal");
      if (modal) modal.classList.remove("open");
      return;
    }

    // Кнопка комментариев - открывает viewer поста
    if (e.target.closest(".action-comment")) {
      e.stopPropagation();
      const postId = e.target.closest(".action-comment").getAttribute("data-id");
      openPostViewer(postId);
      return;
    }

    // Лайк в viewer
    if (e.target.closest("#viewer-like-btn")) {
      e.stopPropagation();
      if (!currentViewingPostId) return;
      const btn = e.target.closest("#viewer-like-btn");
      toggleLike(currentViewingPostId, btn);
      return;
    }

    // Меню комментария
    if (e.target.closest(".comment-menu-btn")) {
      e.stopPropagation();
      document.querySelectorAll(".comment-context-menu").forEach(m => m.classList.remove("show"));
      const btn = e.target.closest(".comment-menu-btn");
      const commentId = btn.getAttribute("data-comment-id");
      const menu = document.getElementById(`menu-comment-${commentId}`);
      if (menu) menu.classList.toggle("show");
      return;
    }

    // Редактировать комментарий
    if (e.target.closest(".edit-comment")) {
      e.stopPropagation();
      const item = e.target.closest(".edit-comment");
      const commentId = item.getAttribute("data-id");
      const content = item.getAttribute("data-content").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      startEditComment(commentId, content);
      return;
    }

    // Удалить комментарий
    if (e.target.closest(".delete-comment")) {
      e.stopPropagation();
      const commentId = e.target.closest(".delete-comment").getAttribute("data-id");
      deleteComment(commentId);
      return;
    }

    // Посты
    if (e.target.id === "btn-publish-post") {
      submitPost();
      return;
    }
    if (e.target.closest(".post-menu-btn")) {
      e.stopPropagation();
      document
        .querySelectorAll(".post-context-menu")
        .forEach((m) => m.classList.remove("show"));
      const menuId = e.target
        .closest(".post-menu-btn")
        .getAttribute("data-target");
      const menu = menuId
        ? document.getElementById(menuId)
        : e.target.closest(".post-menu-btn").nextElementSibling;
      if (menu) menu.classList.toggle("show");
      return;
    }
    if (e.target.closest(".action-edit")) {
      e.stopPropagation();
      editPost(e.target.closest(".action-edit").getAttribute("data-id"));
      return;
    }
    if (e.target.closest(".action-delete")) {
      e.stopPropagation();
      deletePost(e.target.closest(".action-delete").getAttribute("data-id"));
      return;
    }

    // Открытие поста
    const card = e.target.closest(".post-card");
    if (
      card &&
      !e.target.closest("a") &&
      !e.target.closest("button") &&
      !e.target.closest(".reaction-btn") &&
      !e.target.closest(".post-context-menu")
    ) {
      const pid = card.getAttribute("data-id");
      openPostViewer(pid);
      return;
    }

    // Чат / Комментарии / Поиск / Уведомления
    if (e.target.closest("#btn-send-message")) {
      sendMessage();
      return;
    }
    if (e.target.closest("#btn-send-comment")) {
      sendComment();
      return;
    }
    if (e.target.closest("#search-trigger")) {
      const w = document.getElementById("search-wrapper");
      w.classList.toggle("active");
      if (w.classList.contains("active"))
        document.getElementById("header-search-input").focus();
      return;
    }
    const notifyItem = e.target.closest(".notify-item");
    if (notifyItem) {
      const type = notifyItem.getAttribute("data-type");
      const sourceId = notifyItem.getAttribute("data-source");
      if (type === "message")
        window.location.href = `messages.html?openChat=${sourceId}`;
      else if (type === "like" || type === "comment") openPostViewer(sourceId);
      return;
    }

    // Удаление
    if (e.target.id === "btn-confirm-delete") confirmDelete();
    if (e.target.id === "btn-cancel-delete")
      document.getElementById("delete-modal").classList.remove("open");

    // Редактор: Темы
    if (e.target.closest("#topic-trigger")) {
      e.stopPropagation();
      document.getElementById("topic-dropdown").classList.toggle("show");
      return;
    }
    if (e.target.closest(".topic-option")) {
      const opt = e.target.closest(".topic-option");
      document.getElementById("selected-topic-name").innerText = opt.innerText;
      document
        .getElementById("topic-trigger")
        .setAttribute("data-selected-id", opt.getAttribute("data-id"));
      document.getElementById("topic-dropdown").classList.remove("show");
      return;
    }

    // Закрытие при клике вне
    if (
      !e.target.closest(".header-user-block") &&
      !e.target.closest("#user-dropdown")
    )
      document.getElementById("user-dropdown")?.classList.remove("show");
    if (!e.target.closest(".notification-wrapper"))
      document.getElementById("notify-dropdown")?.classList.remove("show");
    if (!e.target.closest(".editor-topic-selector"))
      document.getElementById("topic-dropdown")?.classList.remove("show");
    if (!e.target.closest(".post-menu-btn"))
      document
        .querySelectorAll(".post-context-menu")
        .forEach((m) => m.classList.remove("show"));
    if (!e.target.closest("#btn-edit-cover"))
      document.getElementById("menu-cover")?.classList.remove("show");
    if (!e.target.closest("#avatar-container"))
      document.getElementById("menu-avatar")?.classList.remove("show");
    if (!e.target.closest("#settings-wrapper"))
      document.getElementById("menu-settings")?.classList.remove("show");
    // Добавлено закрытие меню темы
    if (!e.target.closest("#topic-avatar-container"))
      document.getElementById("menu-topic-avatar")?.classList.remove("show");
    if (
      !e.target.closest(".search-wrapper") &&
      !e.target.closest("#search-trigger")
    )
      document.getElementById("search-wrapper")?.classList.remove("active");
  });

  setupAuthForms();
  setupImageUpload();
  setupProfileUploads();
  setupTopicUploads();

  const chatInput = document.getElementById("chat-input");
  if (chatInput)
    chatInput.onkeydown = (e) => {
      if (e.key === "Enter") sendMessage();
    };
}

// === 2. ЗАГРУЗКА ТЕМ (ВОССТАНОВЛЕННЫЕ ФУНКЦИИ) ===

async function loadSidebarTopics() {
  const container = document.getElementById("topics-list-sidebar");
  if (!container) return;

  try {
    const res = await fetch("/api/categories");
    const topics = await res.json();
    container.innerHTML = "";

    topics.forEach((t) => {
      const img =
        t.avatar_url || `https://placehold.co/20/333/white?text=${t.name[0]}`;
      container.innerHTML += `
                <a href="topic.html?id=${t.id}" class="topic-item">
                    <img src="${img}" style="border-radius: 4px;"> ${t.name}
                </a>
            `;
    });

    // Плюсик для админа
    const user = JSON.parse(localStorage.getItem("user"));
    if (user && user.role === "admin") {
      const btn = document.getElementById("admin-add-topic-btn");
      if (btn) btn.style.display = "block";
    }
  } catch (e) {
    console.error(e);
  }
}

async function saveTopic() {
  const name = document.getElementById("topic-name-input").value;
  const desc = document.getElementById("topic-desc-input").value;
  const params = new URLSearchParams(window.location.search);
  const topicId = params.get("id"); // Если редактируем существующую

  if (!name) return alert("Введите название");

  // Определяем: это создание новой или обновление старой?
  // Если мы на странице topic.html и открыли шестеренкой - это обновление
  // Если нажали "+" в сайдбаре (и поле topicId пусто или мы не в контексте) - это создание
  // Для простоты: если есть ID в URL и мы открыли модалку "Настройки темы", это update.
  // Но кнопка "Сохранить" одна.

  // Логика: если заголовок модалки "Новая тема" -> POST, иначе PUT
  const isNew =
    document.getElementById("topic-modal-title").innerText === "Новая тема";
  const url = isNew ? "/api/categories" : `/api/categories/${topicId}`;
  const method = isNew ? "POST" : "PUT";

  try {
    await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: desc }),
    });
    window.location.reload();
  } catch (e) {
    alert("Ошибка");
  }
}

async function deleteTopic() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id || !confirm("Удалить тему и все посты?")) return;
  await fetch(`/api/categories/${id}`, { method: "DELETE" });
  window.location.href = "index.html";
}

function setupTopicUploads() {
  const coverInp = document.getElementById("input-upload-topic-cover");
  const avaInp = document.getElementById("input-upload-topic-avatar");
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (coverInp && id)
    coverInp.onchange = async () => {
      if (coverInp.files.length) {
        const url = await uploadFile(coverInp.files[0]);
        if (url) {
          await fetch(`/api/categories/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cover_url: url }),
          });
          window.location.reload();
        }
      }
    };
  if (avaInp && id)
    avaInp.onchange = async () => {
      if (avaInp.files.length) {
        const url = await uploadFile(avaInp.files[0]);
        if (url) {
          await fetch(`/api/categories/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatar_url: url }),
          });
          window.location.reload();
        }
      }
    };
}

// === 3. ЛОГИКА СТРАНИЦ (loadTopicPageInfo и др) ===

async function loadTopicPageInfo(id) {
  if (!id) return;
  try {
    const res = await fetch(`/api/categories/${id}`);
    const topic = await res.json();

    document.getElementById("topic-title").innerText = topic.name;
    document.getElementById("topic-desc").innerText =
      topic.description || "Нет описания";
    document.getElementById("topic-subs-count").innerText =
      topic.subs_count || 0;

    const cover = document.getElementById("topic-cover");
    if (topic.cover_url)
      cover.style.backgroundImage = `url('${topic.cover_url}')`;
    else {
      cover.style.backgroundImage = "";
      cover.style.backgroundColor = "#333";
    }

    const avatar = document.getElementById("topic-avatar");
    avatar.src =
      topic.avatar_url || `https://placehold.co/100?text=${topic.name[0]}`;

    const subBtn = document.getElementById("btn-topic-subscribe");
    const user = JSON.parse(localStorage.getItem("user"));

    if (user) {
      checkSubscription(user.id, id, subBtn, "topic");
    }

    // === ЛОГИКА ОТОБРАЖЕНИЯ ЭЛЕМЕНТОВ УПРАВЛЕНИЯ ===
    const editCoverBtn = document.getElementById("btn-edit-topic-cover");
    const avatarOverlay = document.getElementById("topic-avatar-overlay");
    const settingsBtn = document.getElementById("btn-admin-settings");
    const avatarContainer = document.getElementById("topic-avatar-container");

    // Курсор всегда "рука", так как все могут смотреть фото
    if (avatarContainer) avatarContainer.style.cursor = "pointer";

    if (user && user.role === "admin") {
      // АДМИН: Видит кнопки ред. обложки, шестеренку и КАРАНДАШ
      if (editCoverBtn) editCoverBtn.style.display = "flex";
      if (settingsBtn) settingsWrapper.style.display = "flex";
      if (avatarOverlay) {
        avatarOverlay.style.display = "flex";
        avatarOverlay.innerHTML = '<i class="fa-solid fa-pen"></i>'; // Карандаш
      }
    } else {
      // ЮЗЕР: Скрываем ред. обложки и шестеренку, но показываем ФОТОАППАРАТ
      if (editCoverBtn) editCoverBtn.style.display = "none";
      if (settingsBtn) settingsBtn.style.display = "none";
      if (avatarOverlay) {
        avatarOverlay.style.display = "flex"; // Показываем!
        avatarOverlay.innerHTML = '<i class="fa-solid fa-camera"></i>'; // Фотоаппарат
      }
    }
  } catch (e) {
    console.error(e);
  }
}

// === ЗАГРУЗКА ПОСТОВ (С АВАТАРКОЙ АВТОРА) ===
// === ЗАГРУЗКА ПОСТОВ (С РАБОЧИМИ РЕАКЦИЯМИ) ===
// Генерация HTML плитки изображений для поста в ленте
function generateImagesGrid(images) {
  if (!images || images.length === 0) return "";

  const first5 = images.slice(0, 5);
  const remaining = Math.max(0, images.length - 5);
  const gridClass = `grid-${first5.length}`;

  let imagesHTML = first5.map((url, index) => {
    const isLast = index === 4 && remaining > 0;
    return `
      <div class="post-grid-img">
        <img src="${url}" alt="Screenshot ${index + 1}">
        ${isLast ? `<div class="more-images-overlay">+${remaining}</div>` : ""}
      </div>
    `;
  }).join("");

  return `<div class="post-images-grid ${gridClass}">${imagesHTML}</div>`;
}

async function loadPosts(sortType, filterId = null) {
  const container = document.getElementById("posts-container");
  if (!container) return;
  container.innerHTML = ""; // Очистка контейнера

  const user = JSON.parse(localStorage.getItem("user"));
  const isAdmin = user && user.role === "admin";
  const myId = user ? user.id : 0; // Передаем ID, чтобы сервер знал, что мы лайкнули

  let url = `/api/posts?sort=${sortType}&userId=${myId}`;
  if (sortType === "topic") url += `&topicId=${filterId}`;
  if (sortType === "author") url += `&authorId=${filterId}`;

  try {
    const response = await fetch(url);
    let posts = await response.json();

    if (posts.length === 0) {
      container.innerHTML =
        '<div style="padding:40px; text-align:center; color:#666;">Пусто...</div>';
      return;
    }

    // Получаем изображения для каждого поста параллельно
    const postsWithImages = await Promise.all(
      posts.map(async (post) => {
        try {
          const imgRes = await fetch(`/api/posts/${post.id}/images`);
          const images = await imgRes.json();
          post.images = images.map(img => img.image_url);
        } catch (e) {
          post.images = [];
        }
        return post;
      })
    );

    postsWithImages.forEach((post) => {
      const canManage = user && (user.id === post.author_id || isAdmin);
      const date = new Date(post.created_at).toLocaleDateString("ru-RU");
      const avatarSrc = post.author_avatar || "https://placehold.co/40";

      // Меню управления (точки)
      let menuHTML = "";
      if (canManage) {
        menuHTML = `
            <button class="post-menu-btn" data-target="menu-post-${post.id}">
                <i class="fa-solid fa-ellipsis"></i>
            </button>
            <div class="post-context-menu" id="menu-post-${post.id}">
                <div class="dropdown-item action-edit" data-id="${post.id}">Редактировать</div>
                <div class="dropdown-item action-delete" data-id="${post.id}" style="color:#ff5e5e;">Удалить</div>
            </div>`;
      }

      // Ссылка на тему
      const topicLink = post.category_name
        ? `<a href="topic.html?id=${post.category_id}" class="post-topic-link" onclick="event.stopPropagation()">${post.category_name}</a> <span class="meta-dot"></span>`
        : "";

      // --- ЛОГИКА ЛАЙКОВ ---
      const isLiked = post.is_liked > 0;
      const likeClass = isLiked ? "active liked" : "";
      const heartIcon = isLiked ? "fa-solid" : "fa-regular";

      // --- ЛОГИКА ЗАКЛАДОК ---
      const isBookmarked = post.is_bookmarked > 0;
      const bookmarkClass = isBookmarked ? "active bookmarked" : "";
      const bookmarkIcon = isBookmarked ? "fa-solid" : "fa-regular";

      // Генерируем плитку изображений
      const imagesGridHTML = generateImagesGrid(post.images);

      const html = `
            <article class="post-card" data-id="${post.id}">
                <div class="post-header">
                    <div class="post-header-left">
                        <a href="profile.html?id=${post.author_id}" onclick="event.stopPropagation()">
                            <img src="${avatarSrc}" class="post-author-avatar">
                        </a>
                        <div class="post-header-info">
                            <a href="profile.html?id=${post.author_id}" onclick="event.stopPropagation()" class="post-author-name">
                                ${post.author_name}
                            </a>
                            <div class="post-meta-line">
                                ${topicLink}
                                <span class="time">${date}</span>
                            </div>
                        </div>
                    </div>
                    <div style="position:relative;">${menuHTML}</div>
                </div>

                <h2 class="post-title">${post.title}</h2>

                ${imagesGridHTML}

                <div class="post-text-content">${post.content}</div>

                <div class="post-footer-actions">
                    <div class="pf-left">
                        <button class="pf-btn action-like ${likeClass}" data-id="${post.id}">
                            <i class="${heartIcon} fa-heart"></i> <span>${post.likes_count || 0}</span>
                        </button>
                        <button class="pf-btn action-comment" data-id="${post.id}">
                            <i class="fa-regular fa-comment"></i> <span>${post.comments_count || 0}</span>
                        </button>
                        <button class="pf-btn action-bookmark ${bookmarkClass}" data-id="${post.id}">
                            <i class="${bookmarkIcon} fa-bookmark"></i> <span>${post.bookmarks_count || 0}</span>
                        </button>
                        <div style="position: relative;">
                            <button class="pf-btn action-share" data-id="${post.id}">
                                <i class="fa-solid fa-share"></i>
                            </button>
                            <div class="share-menu" id="share-menu-${post.id}">
                                <div class="share-option" data-action="telegram" data-id="${post.id}">
                                    <i class="fa-solid fa-paper-plane"></i> Telegram
                                </div>
                                <div class="share-option" data-action="copy" data-id="${post.id}">
                                    <i class="fa-solid fa-link"></i> Копировать ссылку
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="pf-view-count">
                        <i class="fa-regular fa-eye"></i> ${post.views}
                    </div>
                </div>
            </article>`;
      container.innerHTML += html;
    });
  } catch (e) {
    console.error(e);
  }
}

// === 5. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (Те же, что были) ===

async function openPostViewer(postId) {
  const modal = document.getElementById("post-viewer-modal");
  if (!modal) return;
  currentViewingPostId = postId;
  modal.classList.add("open");

  // Увеличиваем счетчик просмотров и получаем свежие данные
  try {
    await fetch(`/api/posts/${postId}/view`, { method: "POST" });
  } catch (e) {
    console.error("Ошибка увеличения просмотров:", e);
  }

  try {
    const user = JSON.parse(localStorage.getItem("user"));
    const url = user
      ? `/api/posts/single/${postId}?userId=${user.id}`
      : `/api/posts/single/${postId}`;

    const res = await fetch(url);
    const post = await res.json();

    console.log("Данные поста из API:", post); // Отладка

    // Проверка что пост загружен
    if (!post || !post.id) {
      console.error("Пост не найден или пустой");
      alert("Ошибка: пост не найден");
      return;
    }

    // Заголовок
    const titleEl = document.getElementById("viewer-post-title");
    if (titleEl) titleEl.innerText = post.title || "Без заголовка";

    // Скрываем текстовое описание, так как оно будет в комментариях
    const contentEl = document.getElementById("viewer-post-content");
    const postTextSection = document.querySelector(".viewer-post-text");
    if (postTextSection) {
      postTextSection.style.display = "none";
    }

    // Автор, категория и дата
    const authorNameEl = document.getElementById("viewer-author-name");
    if (authorNameEl) authorNameEl.innerText = post.author_name || "Автор";

    const avatarEl = document.getElementById("viewer-author-avatar");
    if (avatarEl) avatarEl.src = post.author_avatar || "https://placehold.co/40";

    // Ссылки на профиль автора
    const authorAvatarLink = document.getElementById("viewer-author-avatar-link");
    const authorNameLink = document.getElementById("viewer-author-name-link");
    if (authorAvatarLink && post.author_id) {
      authorAvatarLink.href = `/profile.html?id=${post.author_id}`;
    }
    if (authorNameLink && post.author_id) {
      authorNameLink.href = `/profile.html?id=${post.author_id}`;
    }

    // Тема/категория
    const categoryEl = document.getElementById("viewer-post-category");
    if (categoryEl) {
      categoryEl.innerText = post.category_name || "Без темы";
    }

    // Ссылка на ленту темы
    const categoryLink = document.getElementById("viewer-post-category-link");
    if (categoryLink && post.category_id) {
      categoryLink.href = `/topic.html?id=${post.category_id}`;
    }

    const dateEl = document.getElementById("viewer-post-date");
    if (dateEl) {
      const date = new Date(post.created_at);
      dateEl.innerText = date.toLocaleDateString("ru-RU");
    }

    // Галерея изображений
    const imgBox = document.getElementById("viewer-post-image-box");
    if (imgBox) {
      if (post.images && post.images.length > 0) {
        imgBox.innerHTML = `
          <div class="viewer-gallery-scroll">
            ${post.images.map((url, index) => `<img src="${url}" alt="Screenshot" data-index="${index}" class="gallery-image-clickable">`).join('')}
          </div>
        `;
        imgBox.style.display = "block";

        // Добавляем обработчики клика для открытия полноэкранного режима
        const galleryImages = imgBox.querySelectorAll(".gallery-image-clickable");
        galleryImages.forEach((img) => {
          img.style.cursor = "pointer";
          img.onclick = () => {
            const index = parseInt(img.dataset.index);
            openFullscreenViewer(post.images, index);
          };
        });
      } else {
        imgBox.style.display = "none";
      }
    }

    // Счетчики (используем актуальное значение из БД после инкремента)
    const likesCountEl = document.getElementById("viewer-likes-count");
    if (likesCountEl) likesCountEl.innerText = post.likes_count || 0;

    const bookmarksCountEl = document.getElementById("viewer-bookmarks-count");
    if (bookmarksCountEl) bookmarksCountEl.innerText = post.bookmarks_count || 0;

    const viewsCountEl = document.getElementById("viewer-views-count");
    if (viewsCountEl) viewsCountEl.innerText = post.views || 0;

    // Состояние лайка
    const likeBtn = document.getElementById("viewer-like-btn");
    if (likeBtn) {
      likeBtn.setAttribute("data-id", postId);
      const icon = likeBtn.querySelector("i");
      if (post.is_liked > 0) {
        likeBtn.classList.add("liked");
        if (icon) {
          icon.classList.remove("fa-regular");
          icon.classList.add("fa-solid");
        }
      } else {
        likeBtn.classList.remove("liked");
        if (icon) {
          icon.classList.remove("fa-solid");
          icon.classList.add("fa-regular");
        }
      }
    }

    // Состояние закладки
    const bookmarkBtn = document.getElementById("viewer-bookmark-btn");
    if (bookmarkBtn) {
      bookmarkBtn.setAttribute("data-id", postId);
      const icon = bookmarkBtn.querySelector("i");
      if (post.is_bookmarked > 0) {
        bookmarkBtn.classList.add("bookmarked");
        if (icon) {
          icon.classList.remove("fa-regular");
          icon.classList.add("fa-solid");
        }
      } else {
        bookmarkBtn.classList.remove("bookmarked");
        if (icon) {
          icon.classList.remove("fa-solid");
          icon.classList.add("fa-regular");
        }
      }
    }

    // Показать меню редактирования только владельцу поста
    const menuBtn = document.getElementById("viewer-post-menu-btn");
    if (user && post.author_id === user.id && menuBtn) {
      menuBtn.style.display = "block";
    } else if (menuBtn) {
      menuBtn.style.display = "none";
    }

    loadComments(postId, post);
  } catch (e) {
    console.error(e);
  }
}

// Форматирование времени (как в мессенджерах)
function formatTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "только что";
  if (diffMins < 60) return `${diffMins} мин назад`;
  if (diffHours < 24) return `${diffHours} ч назад`;
  if (diffDays < 7) return `${diffDays} дн назад`;

  // Если больше недели, показываем дату и время
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  return `${date.toLocaleDateString("ru-RU")} ${hours}:${mins}`;
}

// Helper функция для перезагрузки комментариев с данными поста
async function reloadComments(postId) {
  try {
    const user = JSON.parse(localStorage.getItem("user"));
    const url = user
      ? `/api/posts/single/${postId}?userId=${user.id}`
      : `/api/posts/single/${postId}`;

    const postRes = await fetch(url);
    const post = await postRes.json();
    await loadComments(postId, post);

    // Обновляем состояние кнопки лайка
    const likeBtn = document.getElementById("viewer-like-btn");
    if (likeBtn) {
      const icon = likeBtn.querySelector("i");
      if (post.is_liked > 0) {
        likeBtn.classList.add("liked");
        if (icon) {
          icon.classList.remove("fa-regular");
          icon.classList.add("fa-solid");
        }
      } else {
        likeBtn.classList.remove("liked");
        if (icon) {
          icon.classList.remove("fa-solid");
          icon.classList.add("fa-regular");
        }
      }
    }
  } catch (e) {
    console.error("Ошибка перезагрузки комментариев:", e);
  }
}

async function loadComments(postId, postData = null) {
  const list = document.getElementById("viewer-comments-list");
  list.innerHTML = "Загрузка...";
  try {
    const res = await fetch(`/api/posts/${postId}/comments`);
    const comments = await res.json();
    list.innerHTML = "";

    const user = JSON.parse(localStorage.getItem("user"));

    // Добавляем закреплённый комментарий автора, если есть текст поста
    if (postData && postData.content && postData.content.trim() !== "") {
      const timeAgo = formatTime(postData.created_at);
      const isPostOwner = user && user.id === postData.author_id;
      const isAdmin = user && user.role === "admin";
      const canEdit = isPostOwner || isAdmin;

      const controlsHTML = canEdit ? `
        <div class="pinned-comment-controls">
          <button class="pinned-control-btn" id="edit-pinned-comment">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="pinned-control-btn danger" id="delete-pinned-comment">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      ` : '';

      list.innerHTML += `
        <div class="pinned-author-comment" id="pinned-comment-${postData.id}">
          <a href="/profile.html?id=${postData.author_id}" style="text-decoration: none;">
            <img src="${postData.author_avatar || 'https://placehold.co/40'}" class="comment-avatar">
          </a>
          <div class="comment-content">
            <div class="comment-header">
              <div class="comment-header-left">
                <a href="/profile.html?id=${postData.author_id}" style="text-decoration: none;">
                  <div class="comment-author">${postData.author_name}</div>
                </a>
                <span class="pinned-badge">
                  <i class="fa-solid fa-thumbtack"></i>
                  Автор
                </span>
              </div>
              <div class="comment-header-right">
                <div class="comment-time">${timeAgo}</div>
                ${controlsHTML}
              </div>
            </div>
            <div class="comment-text" id="pinned-comment-text-${postData.id}">${postData.content}</div>
          </div>
        </div>
      `;
    }

    // Добавляем фильтр сортировки
    if (comments.length > 0) {
      list.innerHTML += `
        <div class="comment-sort-filter">
          <div class="sort-dropdown">
            <span class="sort-label" id="sort-trigger-btn">Отсортировать по: <span style="font-weight: 600; color: #4683d9;">${commentSortOrder === "old" ? "Старые" : "Новые"}</span></span>
            <div class="sort-menu" id="sort-menu">
              <div class="sort-option ${commentSortOrder === "old" ? "active" : ""}" data-sort="old">Старые</div>
              <div class="sort-option ${commentSortOrder === "new" ? "active" : ""}" data-sort="new">Новые</div>
            </div>
          </div>
        </div>
      `;
    }

    if (comments.length === 0) {
      // Если нет обычных комментариев, но есть комментарий автора - ничего не добавляем
      if (!postData || !postData.content || postData.content.trim() === "") {
        list.innerHTML = "<div style='color:#666; text-align:center; padding:20px;'>Нет комментариев</div>";
      }
      return;
    }

    // Сортируем комментарии в зависимости от выбранного фильтра
    const sortedComments = commentSortOrder === "old"
      ? comments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      : comments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    sortedComments.forEach((c) => {
      const isOwner = user && user.id === c.user_id;
      const isAdmin = user && user.role === "admin";
      const canModify = isOwner || isAdmin;
      const timeAgo = formatTime(c.created_at);
      const menuHTML = canModify ? `
        <button class="comment-menu-btn" data-comment-id="${c.id}">
          <i class="fa-solid fa-ellipsis"></i>
        </button>
        <div class="comment-context-menu" id="menu-comment-${c.id}">
          <div class="comment-menu-item edit-comment" data-id="${c.id}" data-content="${escapeHtml(c.content)}">
            <i class="fa-solid fa-pen"></i> Редактировать
          </div>
          <div class="comment-menu-item danger delete-comment" data-id="${c.id}">
            <i class="fa-solid fa-trash"></i> Удалить
          </div>
        </div>
      ` : '';

      list.innerHTML += `
        <div class="comment-item" id="comment-${c.id}">
          <a href="/profile.html?id=${c.user_id}" style="text-decoration: none;">
            <img src="${c.avatar_url || 'https://placehold.co/40'}" class="comment-avatar">
          </a>
          <div class="comment-content">
            <div class="comment-header">
              <div class="comment-header-left">
                <a href="/profile.html?id=${c.user_id}" style="text-decoration: none;">
                  <div class="comment-author">${c.author_name}</div>
                </a>
              </div>
              <div class="comment-header-right">
                <div class="comment-time">${timeAgo}</div>
                ${menuHTML}
              </div>
            </div>
            <div class="comment-text" id="comment-text-${c.id}">${c.content}</div>
          </div>
        </div>
      `;
    });

    // Добавляем обработчики для кнопок меню комментариев
    setupCommentMenuHandlers();
  } catch (e) {
    list.innerHTML = "Ошибка загрузки комментариев";
  }
}

// Настройка обработчиков для меню комментариев
function setupCommentMenuHandlers() {
  // Обработчик для кнопок меню (три точки)
  document.querySelectorAll(".comment-menu-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const commentId = btn.dataset.commentId;
      const menu = document.getElementById(`menu-comment-${commentId}`);

      // Закрываем все другие меню
      document.querySelectorAll(".comment-context-menu").forEach(m => {
        if (m !== menu) m.classList.remove("show");
      });

      // Переключаем текущее меню
      menu.classList.toggle("show");
    };
  });

  // Обработчик для кнопки "Редактировать"
  document.querySelectorAll(".edit-comment").forEach(btn => {
    btn.onclick = () => {
      const commentId = btn.dataset.id;
      const content = btn.dataset.content;
      startEditComment(commentId, content);
    };
  });

  // Обработчик для кнопки "Удалить"
  document.querySelectorAll(".delete-comment").forEach(btn => {
    btn.onclick = () => {
      const commentId = btn.dataset.id;
      deleteComment(commentId);
    };
  });

  // Закрытие меню при клике вне его
  document.addEventListener("click", () => {
    document.querySelectorAll(".comment-context-menu").forEach(m => {
      m.classList.remove("show");
    });
  });

  // Обработчики для закреплённого комментария автора
  const editPinnedBtn = document.getElementById("edit-pinned-comment");
  if (editPinnedBtn) {
    editPinnedBtn.onclick = () => {
      editPinnedComment();
    };
  }

  const deletePinnedBtn = document.getElementById("delete-pinned-comment");
  if (deletePinnedBtn) {
    deletePinnedBtn.onclick = () => {
      deletePinnedComment();
    };
  }

  // Обработчики для фильтра сортировки
  const sortTrigger = document.getElementById("sort-trigger-btn");
  const sortMenu = document.getElementById("sort-menu");

  if (sortTrigger && sortMenu) {
    sortTrigger.onclick = (e) => {
      e.stopPropagation();
      sortMenu.classList.toggle("show");
    };

    // Обработчик для опций сортировки
    document.querySelectorAll(".sort-option").forEach(option => {
      option.onclick = async () => {
        const newSort = option.dataset.sort;
        if (newSort !== commentSortOrder) {
          commentSortOrder = newSort;
          await reloadComments(currentViewingPostId);
        }
        sortMenu.classList.remove("show");
      };
    });

    // Закрытие меню при клике вне его
    document.addEventListener("click", (e) => {
      if (!sortTrigger.contains(e.target) && !sortMenu.contains(e.target)) {
        sortMenu.classList.remove("show");
      }
    });
  }
}

function escapeHtml(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendComment() {
  const input = document.getElementById("viewer-comment-input");
  const text = input.value.trim();
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) {
    const authModal = document.getElementById("auth-modal");
    if (authModal) authModal.classList.add("open");
    return;
  }
  if (!text) return;
  try {
    await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        article_id: currentViewingPostId,
        author_id: user.id,
        content: text,
      }),
    });
    input.value = "";

    // Обновляем счётчик комментариев в карточке поста
    const commentBtn = document.querySelector(`.action-comment[data-id="${currentViewingPostId}"]`);
    if (commentBtn) {
      const countSpan = commentBtn.querySelector("span");
      if (countSpan) {
        const currentCount = parseInt(countSpan.innerText) || 0;
        countSpan.innerText = currentCount + 1;
      }
    }

    await reloadComments(currentViewingPostId);
  } catch (e) {
    alert("Ошибка");
  }
}

// Редактирование комментария
function startEditComment(commentId, currentContent) {
  const commentItem = document.getElementById(`comment-${commentId}`);
  if (!commentItem) return;

  // Проверяем, есть ли уже форма редактирования
  const existingForm = commentItem.querySelector(".comment-edit-form");
  if (existingForm) return; // Если форма уже есть, не создаем новую

  const commentTextDiv = document.getElementById(`comment-text-${commentId}`);
  commentTextDiv.style.display = "none";

  const editForm = document.createElement("div");
  editForm.className = "comment-edit-form";
  editForm.innerHTML = `
    <textarea class="comment-edit-input" id="edit-input-${commentId}">${currentContent}</textarea>
    <div class="comment-edit-actions">
      <button class="comment-edit-btn comment-edit-cancel" onclick="cancelEditComment(${commentId})">Отмена</button>
      <button class="comment-edit-btn comment-edit-save" onclick="saveEditComment(${commentId})">Сохранить</button>
    </div>
  `;

  commentTextDiv.parentElement.appendChild(editForm);
  document.querySelectorAll(".comment-context-menu").forEach(m => m.classList.remove("show"));
}

function cancelEditComment(commentId) {
  const commentItem = document.getElementById(`comment-${commentId}`);
  if (!commentItem) return;

  const commentTextDiv = document.getElementById(`comment-text-${commentId}`);
  commentTextDiv.style.display = "block";

  const editForm = commentItem.querySelector(".comment-edit-form");
  if (editForm) editForm.remove();
}

async function saveEditComment(commentId) {
  const input = document.getElementById(`edit-input-${commentId}`);
  const newContent = input.value.trim();

  if (!newContent) return alert("Комментарий не может быть пустым");

  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) return;

  try {
    const res = await fetch(`/api/comments/${commentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent, userId: user.id }),
    });

    if (!res.ok) {
      const error = await res.json();
      return alert(error.message || "Ошибка редактирования");
    }

    await reloadComments(currentViewingPostId);
  } catch (e) {
    alert("Ошибка");
  }
}

// Переменная для хранения ID комментария, который нужно удалить
let commentToDelete = null;

function deleteComment(commentId) {
  commentToDelete = commentId;
  const modal = document.getElementById("delete-comment-modal");
  if (modal) modal.classList.add("open");
}

// Редактирование закреплённого комментария (описания поста)
function editPinnedComment() {
  const postId = currentViewingPostId;
  const pinnedCommentDiv = document.querySelector(".pinned-author-comment");
  if (!pinnedCommentDiv) return;

  // Проверяем, есть ли уже форма редактирования
  const existingForm = pinnedCommentDiv.querySelector(".comment-edit-form");
  if (existingForm) return;

  const commentTextDiv = document.getElementById(`pinned-comment-text-${postId}`);
  const currentContent = commentTextDiv.innerText;
  commentTextDiv.style.display = "none";

  const editForm = document.createElement("div");
  editForm.className = "comment-edit-form";
  editForm.innerHTML = `
    <textarea class="comment-edit-input" id="edit-pinned-input">${currentContent}</textarea>
    <div class="comment-edit-actions">
      <button class="btn-cancel-edit" onclick="cancelEditPinned()">Отмена</button>
      <button class="btn-save-edit" onclick="savePinnedComment()">Сохранить</button>
    </div>
  `;

  const contentDiv = pinnedCommentDiv.querySelector(".comment-content");
  contentDiv.appendChild(editForm);
}

function cancelEditPinned() {
  const postId = currentViewingPostId;
  const commentTextDiv = document.getElementById(`pinned-comment-text-${postId}`);
  const editForm = document.querySelector(".pinned-author-comment .comment-edit-form");

  if (editForm) editForm.remove();
  if (commentTextDiv) commentTextDiv.style.display = "block";
}

async function savePinnedComment() {
  const newContent = document.getElementById("edit-pinned-input").value.trim();
  if (!newContent) return alert("Комментарий не может быть пустым");

  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) return;

  try {
    // Обновляем пост (его content)
    const res = await fetch(`/api/posts/${currentViewingPostId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent, userId: user.id }),
    });

    if (!res.ok) {
      const error = await res.json();
      return alert(error.message || "Ошибка редактирования");
    }

    // Перезагружаем пост
    const postRes = await fetch(`/api/posts/single/${currentViewingPostId}`);
    const post = await postRes.json();
    loadComments(currentViewingPostId, post);
  } catch (e) {
    alert("Ошибка");
  }
}

// Переменная для отслеживания удаления закреплённого комментария
let isDeletingPinnedComment = false;

// Удаление закреплённого комментария (очищение content поста)
function deletePinnedComment() {
  isDeletingPinnedComment = true;
  const modal = document.getElementById("delete-comment-modal");
  if (modal) modal.classList.add("open");
}

// Подтверждение удаления закреплённого комментария
async function confirmDeletePinnedComment() {
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) return;

  try {
    const res = await fetch(`/api/posts/${currentViewingPostId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "", userId: user.id }),
    });

    if (!res.ok) {
      const error = await res.json();
      return alert(error.message || "Ошибка удаления");
    }

    // Перезагружаем пост
    const postRes = await fetch(`/api/posts/single/${currentViewingPostId}`);
    const post = await postRes.json();
    loadComments(currentViewingPostId, post);
  } catch (e) {
    alert("Ошибка");
  }
}

// Обработчики для модального окна удаления комментария
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("delete-comment-modal");
  const btnCancel = document.getElementById("btn-cancel-delete-comment");
  const btnConfirm = document.getElementById("btn-confirm-delete-comment");

  // Отмена удаления
  if (btnCancel) {
    btnCancel.onclick = () => {
      modal.classList.remove("open");
      commentToDelete = null;
      isDeletingPinnedComment = false;
    };
  }

  // Подтверждение удаления
  if (btnConfirm) {
    btnConfirm.onclick = async () => {
      // Проверяем, удаляем ли закреплённый комментарий
      if (isDeletingPinnedComment) {
        await confirmDeletePinnedComment();
        modal.classList.remove("open");
        isDeletingPinnedComment = false;
        return;
      }

      // Удаление обычного комментария
      if (!commentToDelete) return;

      const user = JSON.parse(localStorage.getItem("user"));
      if (!user) return;

      try {
        const res = await fetch(`/api/comments/${commentToDelete}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });

        if (!res.ok) {
          const error = await res.json();
          alert(error.message || "Ошибка удаления");
          return;
        }

        modal.classList.remove("open");
        commentToDelete = null;

        // Обновляем счётчик комментариев в карточке поста
        const commentBtn = document.querySelector(`.action-comment[data-id="${currentViewingPostId}"]`);
        if (commentBtn) {
          const countSpan = commentBtn.querySelector("span");
          if (countSpan) {
            const currentCount = parseInt(countSpan.innerText) || 0;
            countSpan.innerText = Math.max(0, currentCount - 1);
          }
        }

        await reloadComments(currentViewingPostId);
      } catch (e) {
        alert("Ошибка");
      }
    };
  }

  // Закрытие по клику на фон
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.remove("open");
        commentToDelete = null;
        isDeletingPinnedComment = false;
      }
    };
  }
});

// === НОВАЯ ФУНКЦИЯ ЛАЙКОВ ===
let isLiking = false; // Флаг для предотвращения двойных кликов

async function toggleLike(postId, btn) {
  if (isLiking) return; // Предотвращаем двойные клики
  isLiking = true;

  console.log("toggleLike вызвана, postId:", postId);

  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) {
    console.log("Пользователь не авторизован");
    isLiking = false;
    document.getElementById("auth-modal").classList.add("open");
    return;
  }

  console.log("Пользователь:", user.id); // Отладка

  const icon = btn.querySelector("i");
  const span = btn.querySelector("span");
  let currentCount = parseInt(span.innerText) || 0;

  try {
    console.log("Отправка запроса на сервер..."); // Отладка
    const res = await fetch(`/api/posts/${postId}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });

    console.log("Ответ сервера, статус:", res.status); // Отладка

    if (!res.ok) {
      console.error("Ошибка сервера:", res.status);
      const errorText = await res.text();
      console.error("Текст ошибки:", errorText);
      return;
    }

    const data = await res.json();
    console.log("Данные от сервера:", data); // Отладка

    // Используем актуальный счетчик с сервера
    const actualCount = data.likesCount || 0;

    if (data.liked) {
      // Лайк добавлен
      console.log("Лайк добавлен");
      btn.classList.add("active", "liked");
      icon.classList.remove("fa-regular");
      icon.classList.add("fa-solid");
      span.innerText = actualCount;
    } else {
      // Лайк убран
      console.log("Лайк убран");
      btn.classList.remove("active", "liked");
      icon.classList.remove("fa-solid");
      icon.classList.add("fa-regular");
      span.innerText = actualCount;
    }

    // Обновляем счетчик и состояние в viewer, если он открыт
    const viewerLikesCount = document.getElementById("viewer-likes-count");
    const viewerLikeBtn = document.getElementById("viewer-like-btn");
    if (viewerLikesCount && currentViewingPostId == postId) {
      viewerLikesCount.innerText = actualCount;

      // Обновляем состояние кнопки лайка в viewer
      if (viewerLikeBtn) {
        const viewerIcon = viewerLikeBtn.querySelector("i");
        if (data.liked) {
          viewerLikeBtn.classList.add("liked");
          if (viewerIcon) {
            viewerIcon.classList.remove("fa-regular");
            viewerIcon.classList.add("fa-solid");
          }
        } else {
          viewerLikeBtn.classList.remove("liked");
          if (viewerIcon) {
            viewerIcon.classList.remove("fa-solid");
            viewerIcon.classList.add("fa-regular");
          }
        }
      }
    }

    // Обновляем счетчик во всех карточках поста в ленте
    const allLikeBtns = document.querySelectorAll(`[onclick*="toggleLike(${postId}"]`);
    allLikeBtns.forEach(likeBtn => {
      const likeSpan = likeBtn.querySelector("span");
      if (likeSpan) likeSpan.innerText = actualCount;
    });

    isLiking = false; // Сбрасываем флаг
  } catch (e) {
    console.error("Ошибка сети:", e);
    alert("Ошибка: " + e.message);
    isLiking = false; // Сбрасываем флаг даже при ошибке
  }
}

// Функция переключения закладки
let isBookmarking = false;
async function toggleBookmark(postId, btn) {
  if (isBookmarking) return;
  isBookmarking = true;

  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) {
    isBookmarking = false;
    document.getElementById("auth-modal").classList.add("open");
    return;
  }

  const icon = btn.querySelector("i");
  const span = btn.querySelector("span");
  let currentCount = parseInt(span.innerText) || 0;

  try {
    const res = await fetch(`/api/posts/${postId}/bookmark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });

    if (!res.ok) {
      console.error("Ошибка сервера:", res.status);
      return;
    }

    const data = await res.json();
    const actualCount = data.bookmarksCount || 0;

    if (data.bookmarked) {
      // Закладка добавлена
      btn.classList.add("active", "bookmarked");
      icon.classList.remove("fa-regular");
      icon.classList.add("fa-solid");
      span.innerText = actualCount;
    } else {
      // Закладка убрана
      btn.classList.remove("active", "bookmarked");
      icon.classList.remove("fa-solid");
      icon.classList.add("fa-regular");
      span.innerText = actualCount;
    }

    // Обновляем счетчик и состояние в viewer, если он открыт
    const viewerBookmarksCount = document.getElementById("viewer-bookmarks-count");
    const viewerBookmarkBtn = document.getElementById("viewer-bookmark-btn");
    if (viewerBookmarksCount && currentViewingPostId == postId) {
      viewerBookmarksCount.innerText = actualCount;

      if (viewerBookmarkBtn) {
        const viewerIcon = viewerBookmarkBtn.querySelector("i");
        if (data.bookmarked) {
          viewerBookmarkBtn.classList.add("bookmarked");
          if (viewerIcon) {
            viewerIcon.classList.remove("fa-regular");
            viewerIcon.classList.add("fa-solid");
          }
        } else {
          viewerBookmarkBtn.classList.remove("bookmarked");
          if (viewerIcon) {
            viewerIcon.classList.remove("fa-solid");
            viewerIcon.classList.add("fa-regular");
          }
        }
      }
    }

    isBookmarking = false;
  } catch (e) {
    console.error("Ошибка сети:", e);
    alert("Ошибка: " + e.message);
    isBookmarking = false;
  }
}

// === ЛОГИКА ПРОФИЛЯ (ИСПРАВЛЕННАЯ АВАТАРКА) ===
async function loadUserProfile(id) {
  try {
    const res = await fetch(`/api/users/${id}`);
    const user = await res.json();
    const me = JSON.parse(localStorage.getItem("user"));

    // Данные
    document.getElementById("user-name").innerText = user.name || "Без имени";
    document.getElementById("user-avatar").src =
      user.avatar_url || "https://placehold.co/120";
    document.getElementById("posts-count").innerText = user.posts_count || 0;

    const commentsCountEl = document.getElementById("comments-count");
    if (commentsCountEl) {
      commentsCountEl.innerText = user.comments_count || 0;
    }

    document.getElementById("user-followers").innerText =
      user.followers_count || 0;
    document.getElementById("user-following").innerText =
      user.following_count || 0;

    // Дата
    if (user.created_at) {
      const date = new Date(user.created_at).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      document.getElementById("user-date").innerText = `На сайте с ${date}`;
    }

    // Обложка
    const cover = document.getElementById("user-cover");
    if (user.cover_url)
      cover.style.backgroundImage = `url('${user.cover_url}')`;
    else {
      cover.style.backgroundImage = "";
      cover.style.backgroundColor = "#333";
    }

    // Элементы управления
    const subBtn = document.getElementById("btn-subscribe");
    const msgBtn = document.getElementById("btn-open-chat");
    const editCoverBtn = document.getElementById("btn-edit-cover");

    const settingsWrapper = document.getElementById("settings-wrapper");
    const statusWrapper = document.querySelector(".profile-desc-wrapper");
    const statusEl = document.getElementById("user-status");
    const editStatusBtn = document.getElementById("btn-edit-status");
    const avatarOverlay = document.querySelector(".avatar-overlay");

    // Сброс меню
    document.getElementById("menu-avatar")?.classList.remove("show");
    document.getElementById("menu-cover")?.classList.remove("show");
    document.getElementById("menu-settings")?.classList.remove("show");

    // Проверка статуса
    const isEmptyStatus =
      !user.status ||
      user.status.trim() === "" ||
      user.status === "Напишите что-нибудь о себе...";

    if (me && me.id == id) {
      // === МОЙ ПРОФИЛЬ ===
      if (editCoverBtn) editCoverBtn.style.display = "flex";
      if (settingsWrapper) settingsWrapper.style.display = "block";
      if (avatarOverlay) avatarOverlay.style.display = "";

      // Прячем чужие кнопки
      if (subBtn) subBtn.style.display = "none";
      if (msgBtn) msgBtn.style.display = "none";

      // СТАТУС (Всегда показываем владельцу)
      statusWrapper.style.display = "flex";
      editStatusBtn.style.display = "block"; // Показываем карандаш

      if (isEmptyStatus) {
        statusEl.innerText = "Добавить описание";
        statusEl.style.color = "#555";
        statusEl.style.cursor = "pointer";
        // Клик по тексту вызывает редактор
        statusEl.onclick = (e) => {
          e.stopPropagation();
          enableStatusEdit();
        };
      } else {
        statusEl.innerText = user.status;
        statusEl.style.color = "#ccc";
        statusEl.style.cursor = "text";
        statusEl.onclick = null;
      }
    } else {
      // === ЧУЖОЙ ПРОФИЛЬ ===
      if (editCoverBtn) editCoverBtn.style.display = "none";
      if (settingsWrapper) settingsWrapper.style.display = "none";
      if (avatarOverlay) avatarOverlay.style.display = "none";
      document.getElementById("menu-avatar")?.remove();

      // СТАТУС (Прячем, если пустой)
      editStatusBtn.style.display = "none"; // Прячем карандаш
      if (isEmptyStatus) {
        statusWrapper.style.display = "none";
      } else {
        statusWrapper.style.display = "flex";
        statusEl.innerText = user.status;
        statusEl.style.color = "#ccc";
        statusEl.onclick = null;
      }

      if (subBtn) {
        subBtn.style.display = "block";
        checkSubscription(me?.id, id, subBtn);
        subBtn.onclick = () => toggleSubscription(me?.id, id, subBtn);
      }
      if (msgBtn) {
        msgBtn.style.display = "flex";
        msgBtn.onclick = () => openChat(me?.id, id, user.name);
      }

      // Кнопка СООБЩЕНИЕ (Видна ТОЛЬКО если авторизован)
      if (msgBtn) {
        if (me) {
          msgBtn.style.display = "flex";
          msgBtn.onclick = () => openChat(me.id, id, user.name);
        } else {
          msgBtn.style.display = "none"; // Прячем для гостя
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
}

// === КНОПКА ПОДПИСКИ (С АНИМАЦИЕЙ И СМЕНОЙ ТЕКСТА) ===
function updateSubButton(btn, isSubscribed) {
  // Убираем старые обработчики, чтобы не множились
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  // Восстанавливаем обработчик клика
  newBtn.onclick = () => {
    // Получаем параметры заново (так как клон потерял замыкание)
    const user = JSON.parse(localStorage.getItem("user"));
    if (!user) return openAuthModal();

    // Определяем targetId и type из контекста страницы
    let targetId, type;
    const params = new URLSearchParams(window.location.search);

    if (btn.id === "btn-topic-subscribe") {
      targetId = params.get("id");
      type = "topic";
    } else {
      // Для профиля пользователя
      targetId =
        params.get("id") ||
        (user.id != params.get("id") ? params.get("id") : null);
      // Если id в URL нет, значит это профиль... стоп, подписка нужна только на чужом
      targetId = params.get("id");
      type = "author";
    }
    toggleSubscription(user.id, targetId, newBtn, type);
  };

  if (isSubscribed) {
    newBtn.innerText = "Вы подписаны";
    newBtn.classList.add("subscribed");
    newBtn.style.background = ""; // Сбрасываем инлайн стиль, чтобы работал CSS класс
    newBtn.style.color = "";

    // Логика наведения: "Вы подписаны" <-> "Отписаться"
    newBtn.onmouseenter = () => (newBtn.innerText = "Отписаться");
    newBtn.onmouseleave = () => (newBtn.innerText = "Вы подписаны");
  } else {
    newBtn.innerText = "Подписаться";
    newBtn.classList.remove("subscribed");
    newBtn.style.background = "#4683d9"; // Возвращаем синий цвет
    newBtn.style.color = "#fff";

    newBtn.onmouseenter = null;
    newBtn.onmouseleave = null;
  }
}

function openAvatarViewer() {
  document.getElementById("viewer-img").src =
    document.getElementById("user-avatar").src;
  document.getElementById("avatar-viewer").classList.add("open");
}

function setupProfileUploads() {
  const inputCover = document.getElementById("input-upload-cover");
  const inputAvatar = document.getElementById("input-upload-avatar");
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) return;

  if (inputCover)
    inputCover.onchange = async () => {
      if (inputCover.files.length) {
        const url = await uploadFile(inputCover.files[0]);
        if (url) {
          await updateUserProfile(user.id, { cover_url: url });
          window.location.reload();
        }
      }
    };
  if (inputAvatar)
    inputAvatar.onchange = async () => {
      if (inputAvatar.files.length) {
        const url = await uploadFile(inputAvatar.files[0]);
        if (url) {
          const updatedUser = await updateUserProfile(user.id, {
            avatar_url: url,
          });
          if (updatedUser)
            localStorage.setItem("user", JSON.stringify(updatedUser));
          window.location.reload();
        }
      }
    };
}

function enableStatusEdit() {
  const statusEl = document.getElementById("user-status");
  const currentText = statusEl.innerText;
  const parent = statusEl.parentNode;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "status-input";
  input.value = currentText === "Добавить описание" ? "" : currentText;
  statusEl.style.display = "none";
  document.getElementById("btn-edit-status").style.display = "none";
  parent.appendChild(input);
  input.focus();

  const save = async () => {
    const val = input.value.trim();
    if (val !== currentText) {
      const user = JSON.parse(localStorage.getItem("user"));
      await updateUserProfile(user.id, { status: val });
    }
    window.location.reload();
  };
  input.onblur = save;
  input.onkeydown = (e) => {
    if (e.key === "Enter") input.blur();
  };
}

async function deleteCover() {
  const user = JSON.parse(localStorage.getItem("user"));
  if (confirm("Удалить обложку?")) {
    await updateUserProfile(user.id, { cover_url: null });
    window.location.reload();
  }
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append("image", file);
  try {
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    return (await r.json()).url;
  } catch (e) {
    return null;
  }
}
async function updateUserProfile(id, data) {
  try {
    const r = await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return (await r.json()).user;
  } catch (e) {
    return null;
  }
}

// === КОММЕНТАРИИ ПОЛЬЗОВАТЕЛЯ В ПРОФИЛЕ ===
let currentUserCommentsSort = "new";

async function loadUserComments(userId, sort = "new") {
  try {
    const res = await fetch(`/api/users/${userId}/comments?sort=${sort}`);
    const comments = await res.json();

    const container = document.getElementById("user-comments-list");
    if (!container) return;

    container.innerHTML = "";

    if (comments.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #666;">
          <i class="fa-regular fa-comment" style="font-size: 48px; margin-bottom: 15px; display: block;"></i>
          Комментариев пока нет
        </div>
      `;
      return;
    }

    comments.forEach(comment => {
      const date = new Date(comment.created_at).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });

      const avatarSrc = comment.author_avatar || "https://placehold.co/40";

      const commentHTML = `
        <div class="user-comment-item">
          <div class="user-comment-author-info">
            <img src="${avatarSrc}" class="user-comment-avatar" alt="${comment.author_name}">
            <div class="user-comment-meta">
              <div class="user-comment-author-name">${comment.author_name}</div>
              <div class="user-comment-post-link" onclick="openPostViewer(${comment.post_id}); event.stopPropagation();">
                ${comment.post_title}
              </div>
            </div>
            <div class="user-comment-date">${date}</div>
          </div>
          <div class="user-comment-content">${comment.content}</div>
        </div>
      `;

      container.innerHTML += commentHTML;
    });
  } catch (e) {
    console.error("Ошибка загрузки комментариев:", e);
  }
}

function initProfileTabs() {
  const tabs = document.querySelectorAll(".profile-tab");
  const postsContainer = document.getElementById("posts-container");
  const commentsContainer = document.getElementById("comments-container");

  if (!tabs.length || !postsContainer || !commentsContainer) return;

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const tabType = tab.getAttribute("data-tab");

      // Переключаем активный таб
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const params = new URLSearchParams(window.location.search);
      const profileId = params.get("id") || JSON.parse(localStorage.getItem("user"))?.id;

      if (tabType === "posts") {
        postsContainer.style.display = "block";
        commentsContainer.style.display = "none";
      } else if (tabType === "comments") {
        postsContainer.style.display = "none";
        commentsContainer.style.display = "block";

        if (profileId) {
          loadUserComments(profileId, currentUserCommentsSort);
        }
      }
    });
  });

  // Обработчик сортировки комментариев
  const sortTrigger = document.querySelector("#comments-container .sort-trigger");
  const sortMenu = document.querySelector("#comments-container .comments-sort-menu");
  const sortOptions = document.querySelectorAll("#comments-container .sort-option");

  if (sortTrigger && sortMenu) {
    sortTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      sortMenu.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".comments-sort-header")) {
        sortMenu?.classList.remove("show");
      }
    });
  }

  sortOptions.forEach(option => {
    option.addEventListener("click", () => {
      const sort = option.getAttribute("data-sort");
      currentUserCommentsSort = sort;

      sortOptions.forEach(o => o.classList.remove("active"));
      option.classList.add("active");

      const params = new URLSearchParams(window.location.search);
      const profileId = params.get("id") || JSON.parse(localStorage.getItem("user"))?.id;

      if (profileId) {
        loadUserComments(profileId, sort);
      }

      sortMenu?.classList.remove("show");
    });
  });
}

// === 3. АВТОРИЗАЦИЯ И ШАПКА (C АНИМАЦИЕЙ) ===
function checkAuth() {
  const user = JSON.parse(localStorage.getItem("user"));
  const container = document.getElementById("auth-container");
  if (!container) return;
  container.innerHTML = "";

  // Кнопка "Опубликовать"
  const pubBtn = `<button class="btn-write"><i class="fa-solid fa-pen"></i> Опубликовать</button>`;

  if (user) {
    // Уведомления
    const notifyHTML = `
            <div class="notification-wrapper">
                <button class="btn-icon-header" onclick="toggleNotifications()">
                    <i class="fa-regular fa-bell"></i>
                    <span class="notify-badge" id="notify-badge" style="display:none"></span>
                </button>
                <div class="notification-dropdown" id="notify-dropdown">
                    <div class="notify-header"><span>Уведомления</span></div>
                    <div class="notify-list" id="notify-list"></div>
                </div>
            </div>`;

    // Профиль (С АНИМИРОВАННЫМ КОЛЬЦОМ)
    const profileHTML = `
            <div class="header-user-block" onclick="document.getElementById('user-dropdown').classList.toggle('show')">
                
                <div class="avatar-ring">
                    <img src="${
                      user.avatar_url || "https://placehold.co/40"
                    }" class="user-mini-avatar">
                </div>
                
                <i class="fa-solid fa-chevron-down" style="font-size: 12px; color: #ccc;"></i>
                
                <div class="profile-dropdown" id="user-dropdown" style="top: 55px; right: -10px;">
                    <div class="dropdown-header" onclick="window.location.href='profile.html?id=${
                      user.id
                    }'">
                        <div class="name">${user.name}</div>
                        <div class="tag">Мой профиль</div>
                    </div>
                    <div class="dropdown-divider"></div>
                    <a href="#" class="dropdown-item">Черновики</a>
                    <a href="bookmarks.html" class="dropdown-item">Закладки</a>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item" onclick="logout()" style="color:#ff5e5e;">Выйти</div>
                </div>
            </div>
        `;

    container.insertAdjacentHTML("beforeend", notifyHTML);
    container.insertAdjacentHTML("beforeend", pubBtn);
    container.insertAdjacentHTML("beforeend", profileHTML);
  } else {
    container.insertAdjacentHTML("beforeend", pubBtn);
    container.insertAdjacentHTML(
      "beforeend",
      `<button class="btn-login" onclick="openAuthModal()">Войти</button>`
    );
  }
}

function logout() {
  localStorage.removeItem("user");
  window.location.href = "index.html";
}
function openAuthModal() {
  document.getElementById("auth-modal").classList.add("open");
}

function setupAuthForms() {
  const logForm = document.getElementById("screen-login");
  if (logForm)
    logForm.onsubmit = async (e) => {
      e.preventDefault();
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("login-email").value,
          password: document.getElementById("login-password").value,
        }),
      });
      if (res.ok) {
        localStorage.setItem("user", JSON.stringify(await res.json()));
        window.location.reload();
      } else alert("Ошибка");
    };
  const regForm = document.getElementById("screen-register");
  if (regForm)
    regForm.onsubmit = async (e) => {
      e.preventDefault();
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: document.getElementById("reg-name").value,
          email: document.getElementById("reg-email").value,
          password: document.getElementById("reg-password").value,
        }),
      });
      if (res.ok) {
        alert("Успешно!");
        window.location.reload();
      } else alert("Ошибка");
    };
  const toReg = document.getElementById("link-to-reg");
  if (toReg)
    toReg.onclick = () => {
      document.getElementById("screen-start").classList.remove("active");
      document.getElementById("screen-register").classList.add("active");
    };
  const toLog = document.getElementById("btn-to-email");
  if (toLog)
    toLog.onclick = () => {
      document.getElementById("screen-start").classList.remove("active");
      document.getElementById("screen-login").classList.add("active");
    };
}

function handleRouting() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  if (path.includes("topic.html")) {
    loadTopicPageInfo(params.get("id"));
    loadPosts("topic", params.get("id"));
    setActiveNav("topic");
  } else if (path.includes("rating.html")) {
    loadTopUsers();
    loadPosts("popular");
    setActiveNav("rating");
  } else if (path.includes("fresh.html")) {
    loadPosts("fresh");
    setActiveNav("fresh");
  } else if (path.includes("bookmarks.html")) {
    loadPosts("bookmarks");
    setActiveNav("bookmarks");
  } else if (path.includes("feed.html")) {
    loadPosts("feed");
    setActiveNav("feed");
  } else if (path.includes("messages.html")) {
    loadConversations();
    setActiveNav("messages");
  } else if (path.includes("profile.html")) {
    const user = JSON.parse(localStorage.getItem("user"));
    const profileId = params.get("id") || (user ? user.id : null);
    if (profileId) {
      loadUserProfile(profileId);
      loadPosts("author", profileId);
      initProfileTabs();
    } else window.location.href = "index.html";
  } else {
    loadPosts("popular");
    setActiveNav("popular");
  }
}

function openEditor(postData = null) {
  const modal = document.getElementById("post-editor-modal");
  const user = JSON.parse(localStorage.getItem("user"));
  if (!modal) return alert("Ошибка HTML: нет окна редактора");

  loadEditorTopics();
  document.getElementById("editor-user-name").innerText = user.name;

  const title = document.getElementById("post-title");
  const content = document.getElementById("post-content");
  const btn = document.getElementById("btn-publish-post");
  const previewContainer = document.getElementById("images-preview-container");
  const placeholder = document.getElementById("upload-placeholder");
  const topicName = document.getElementById("selected-topic-name");
  const trigger = document.getElementById("topic-trigger");

  title.value = "";
  content.value = "";
  currentImages = [];
  previewContainer.innerHTML = "";
  updateImagesCounter();
  if (trigger) trigger.removeAttribute("data-selected-id");

  if (postData) {
    editingPostId = postData.id;
    title.value = postData.title;
    content.value = postData.content;
    btn.innerText = "Сохранить";

    if (postData.images && postData.images.length > 0) {
      currentImages = postData.images;
      currentImages.forEach((url, i) => renderImagePreview(url, i));
      updateImagesCounter();
    }

    if (postData.category_id) {
      topicName.innerText = "Тема сохранена";
      if (trigger) trigger.setAttribute("data-selected-id", postData.category_id);
    } else {
      topicName.innerText = "Без темы";
    }
  } else {
    editingPostId = null;
    btn.innerText = "Опубликовать";
    topicName.innerText = "Без темы";
  }

  modal.classList.add("open");

  if (trigger) {
    const newTrigger = trigger.cloneNode(true);
    trigger.parentNode.replaceChild(newTrigger, trigger);
    newTrigger.onclick = (e) => {
      e.stopPropagation();
      document.getElementById("topic-dropdown").classList.toggle("show");
    };
    document.querySelectorAll(".topic-option").forEach((opt) => {
      opt.onclick = function () {
        document.getElementById("selected-topic-name").innerText = this.innerText;
        newTrigger.setAttribute("data-selected-id", this.getAttribute("data-id"));
      };
    });
  }
}
function setupImageUpload() {
  const input = document.getElementById("file-input");
  const placeholder = document.getElementById("upload-placeholder");
  const previewContainer = document.getElementById("images-preview-container");
  const counter = document.getElementById("images-counter");

  if (placeholder) {
    placeholder.onclick = () => {
      if (currentImages.length < 15) {
        input.click();
      } else {
        alert("Максимум 15 изображений");
      }
    };
  }

  if (input) {
    input.onchange = async () => {
      const files = Array.from(input.files);
      const remaining = 15 - currentImages.length;

      if (files.length > remaining) {
        alert(`Можно добавить еще только ${remaining} изображений`);
        return;
      }

      for (const file of files) {
        const url = await uploadFile(file);
        if (url) {
          currentImages.push(url);
          renderImagePreview(url, currentImages.length - 1);
        }
      }

      updateImagesCounter();
      input.value = "";
    };
  }
}

function renderImagePreview(url, index) {
  const container = document.getElementById("images-preview-container");
  const item = document.createElement("div");
  item.className = "image-preview-item";
  item.innerHTML = `
    <img src="${url}" alt="Preview">
    <button class="btn-remove-img" onclick="removeImage(${index})">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;
  container.appendChild(item);
}

function removeImage(index) {
  currentImages.splice(index, 1);
  const container = document.getElementById("images-preview-container");
  container.innerHTML = "";
  currentImages.forEach((url, i) => renderImagePreview(url, i));
  updateImagesCounter();
}

function updateImagesCounter() {
  const counter = document.getElementById("images-counter");
  if (counter) {
    counter.innerText = `${currentImages.length}/15`;
  }
}
async function submitPost() {
  const title = document.getElementById("post-title").value;
  const content = document.getElementById("post-content").value;
  const topicId = document
    .getElementById("topic-trigger")
    ?.getAttribute("data-selected-id");
  const user = JSON.parse(localStorage.getItem("user"));

  if (!title) return alert("Введите заголовок");
  if (currentImages.length === 0) return alert("Добавьте хотя бы одно изображение");

  const url = editingPostId
    ? `/api/posts/${editingPostId}`
    : "/api/posts/create";
  const method = editingPostId ? "PUT" : "POST";

  try {
    await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content,
        author_id: user.id,
        category_id: topicId,
        images: currentImages,
      }),
    });
    window.location.reload();
  } catch (e) {
    alert("Ошибка");
  }
}
async function editPost(id) {
  const r = await fetch(`/api/posts/single/${id}`);
  openEditor(await r.json());
}
function deletePost(id) {
  postToDeleteId = id;
  document.getElementById("delete-modal").classList.add("open");
}
async function confirmDelete() {
  if (!postToDeleteId) return;
  await fetch(`/api/posts/${postToDeleteId}`, { method: "DELETE" });
  window.location.reload();
}
// === ПОДПИСКА (Без надоедливого Alert) ===
async function toggleSubscription(myId, targetId, btn, type = "author") {
  if (!myId) return document.getElementById("auth-modal").classList.add("open");
  if (!targetId || targetId === "null") return;

  try {
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscriber_id: myId,
        target_id: targetId,
        type: type,
      }),
    });

    // Если сервер вернул ошибку, просто выходим, не показывая alert
    if (!res.ok) {
      console.error("Ошибка сервера при подписке");
      return;
    }

    const data = await res.json();

    // Проверяем статус
    const isSubscribed = data.status === "subscribed";

    // Обновляем вид кнопки
    updateSubButton(btn, isSubscribed);

    // Обновляем счетчик (только если это страница темы)
    if (type === "topic") {
      const countEl = document.getElementById("topic-subs-count");
      if (countEl) {
        let count = parseInt(countEl.innerText) || 0;
        countEl.innerText = isSubscribed ? count + 1 : Math.max(0, count - 1);
      }
    }
  } catch (e) {
    console.error(e);
    // alert("Ошибка при подписке"); // <-- УБРАЛИ ЭТУ СТРОКУ
  }
}

async function checkSubscription(myId, targetId, btn, type = "author") {
  // Строгая проверка: если ID нет или они undefined/null -> выходим
  if (!myId || !targetId || targetId === "null" || targetId === "undefined")
    return;

  try {
    const r = await fetch(
      `/api/check-subscription?subscriber_id=${myId}&target_id=${targetId}&type=${type}`
    );
    if (r.ok) {
      const d = await r.json();
      updateSubButton(btn, d.isSubscribed);
    }
  } catch (e) {
    console.error("Ошибка проверки подписки:", e);
  }
}
function openChat(myId, partnerId, name) {
  document.getElementById("chat-partner-name").innerText = name;
  currentChatPartnerId = partnerId;
  document.getElementById("chat-modal").classList.add("open");
  loadMessages(myId, partnerId);
}
async function sendMessage() {
  const t = document.getElementById("chat-input").value;
  const u = JSON.parse(localStorage.getItem("user"));
  if (!t) return;
  document.getElementById(
    "chat-messages-area"
  ).innerHTML += `<div class="message-bubble me">${t}</div>`;
  document.getElementById("chat-input").value = "";
  await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender_id: u.id,
      receiver_id: currentChatPartnerId,
      content: t,
    }),
  });
}
async function loadMessages(myId, partnerId) {
  const a = document.getElementById("chat-messages-area");
  const r = await fetch(`/api/messages/${partnerId}?myId=${myId}`);
  const m = await r.json();
  a.innerHTML = "";
  m.forEach(
    (x) =>
      (a.innerHTML += `<div class="message-bubble ${
        x.sender_id == myId ? "me" : "partner"
      }">${x.content}</div>`)
  );
  a.scrollTop = a.scrollHeight;
}
// === СПИСОК ДИАЛОГОВ (ОБНОВЛЕНО) ===
async function loadConversations() {
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) return (window.location.href = "index.html");

  const container = document.getElementById("conversations-list");
  if (!container) return;

  container.innerHTML =
    "<div style='padding:20px;text-align:center;color:#666'>Загрузка...</div>";

  try {
    const res = await fetch(`/api/conversations?userId=${user.id}`);
    const list = await res.json();

    container.innerHTML = "";

    if (list.length === 0) {
      container.innerHTML =
        "<div style='padding:20px;color:#666;text-align:center'>Нет сообщений</div>";
      return;
    }

    list.forEach((item) => {
      // Обрезаем длинное сообщение для превью
      let previewText = item.last_msg || "Нет сообщений";
      if (previewText.length > 50)
        previewText = previewText.substring(0, 50) + "...";

      container.innerHTML += `
                <div class="conversation-item" onclick="openChat(${user.id}, ${
        item.partner_id
      }, '${item.name}')">
                    <img src="${
                      item.avatar_url || "https://placehold.co/40"
                    }" class="conversation-avatar">
                    <div class="conversation-info">
                        <div class="name">${item.name}</div>
                        <div class="last-msg" style="color:#888; font-size:13px; margin-top:2px;">${previewText}</div>
                    </div>
                </div>`;
    });
  } catch (e) {
    console.error(e);
    container.innerHTML =
      "<div style='padding:20px;color:red;text-align:center'>Ошибка загрузки</div>";
  }
}
async function toggleNotifications() {
  document.getElementById("notify-dropdown").classList.toggle("show");
  const user = JSON.parse(localStorage.getItem("user"));
  const list = document.getElementById("notify-list");
  list.innerHTML = "Загрузка...";
  const res = await fetch(`/api/notifications?userId=${user.id}`);
  const data = await res.json();
  list.innerHTML = "";
  if (data.length === 0)
    list.innerHTML =
      "<div style='padding:15px;color:#666;text-align:center'>Нет уведомлений</div>";
  data.forEach(
    (n) =>
      (list.innerHTML += `<div class="notify-item"><div class="notify-content">${n.text}</div></div>`)
  );
}

// === ЗАГРУЗКА ТОП АВТОРОВ (Сайдбар + Рейтинг) ===
async function loadTopUsers() {
  try {
    const res = await fetch("/api/top-users");
    const users = await res.json();

    // 1. САЙДБАР (Для всех страниц: index, fresh, feed, messages, topic, post)
    // Ищем контейнер с ID "top-authors-list"
    const sidebarList = document.getElementById("top-authors-list");
    if (sidebarList) {
      sidebarList.innerHTML = "";
      // Берем только первых 3 авторов
      users.slice(0, 3).forEach((u, index) => {
        let rankColor = "#888";
        if (index === 0) rankColor = "#ffd700";
        else if (index === 1) rankColor = "#c0c0c0";
        else if (index === 2) rankColor = "#cd7f32";

        sidebarList.innerHTML += `
                <li onclick="window.location.href='profile.html?id=${
                  u.id
                }'" style="cursor: pointer; display:flex; align-items:center; margin-bottom:12px;">
                    <div class="blog-rank" style="color:${rankColor}; width:20px; font-weight:bold; text-align:center; margin-right:8px;">${
          index + 1
        }</div>
                    <div class="blog-avatar">
                        <img src="${
                          u.avatar_url || "https://placehold.co/40"
                        }" style="width:36px; height:36px; border-radius:50%; object-fit:cover; margin-right:10px; background:#333;">
                    </div>
                    <div class="blog-info">
                        <div class="name" style="font-size:13px; font-weight:600;">${
                          u.name
                        }</div>
                        <div class="subs" style="font-size:11px; color:#8a8a8a;">${
                          u.followers_count
                        } подписчиков</div>
                    </div>
                </li>`;
      });
    }

    // 2. СТРАНИЦА РЕЙТИНГА (rating.html)
    // Ищем контейнер с ID "top-users-list"
    const ratingList = document.getElementById("top-users-list");
    if (ratingList) {
      ratingList.innerHTML = "";
      // Тут показываем всех 5
      users.forEach((u) => {
        ratingList.innerHTML += `
                <div style="text-align:center; min-width:100px; cursor:pointer;" onclick="window.location.href='profile.html?id=${
                  u.id
                }'">
                    <img src="${
                      u.avatar_url || "https://placehold.co/50"
                    }" style="width:60px; height:60px; border-radius:50%; margin-bottom:5px; object-fit:cover;">
                    <div style="font-size:14px; font-weight:bold;">${
                      u.name
                    }</div>
                    <div style="font-size:12px; color:#888;">${
                      u.followers_count
                    } подписчиков</div>
                </div>`;
      });
    }
  } catch (e) {
    console.error(e);
  }
}

// === НОВАЯ ФУНКЦИЯ: Загрузка тем в редактор ===
async function loadEditorTopics() {
  const container = document.getElementById("topic-dropdown");
  if (!container) return;

  try {
    const res = await fetch("/api/categories");
    const topics = await res.json();

    // Очищаем старые (захардкоженные) темы
    container.innerHTML = "";

    // Добавляем актуальные из базы
    topics.forEach((t) => {
      container.innerHTML += `<div class="topic-option" data-id="${t.id}">${t.name}</div>`;
    });
  } catch (e) {
    console.error("Ошибка загрузки тем:", e);
  }
}

function setActiveNav(type) {
  document.querySelectorAll(".nav-item").forEach((i) => {
    i.classList.remove("active");

    const href = i.getAttribute("href"); // Получаем саму ссылку (index.html, fresh.html...)

    // Если мы на главной ("popular"), то подсвечиваем index.html
    if (type === "popular") {
      if (href === "index.html" || href === "/" || href === "./") {
        i.classList.add("active");
      }
    }
    // Для остальных страниц ищем совпадение по имени (fresh, feed, rating...)
    else if (href && href.includes(type)) {
      i.classList.add("active");
    }
  });
}

async function saveNewName() {
  const input = document.getElementById("input-new-name");
  const newName = input.value.trim();
  const user = JSON.parse(localStorage.getItem("user"));

  if (!newName) return alert("Имя не может быть пустым");
  if (!user) return;

  try {
    // Отправляем на сервер
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });

    const data = await res.json();
    if (data.user) {
      // Обновляем данные в браузере
      localStorage.setItem("user", JSON.stringify(data.user));
      window.location.reload();
    } else {
      alert("Ошибка обновления");
    }
  } catch (e) {
    console.error(e);
    alert("Ошибка сети");
  }
}

// === ТОП АВТОРОВ В САЙДБАРЕ (ИСПРАВЛЕНО: ТОЛЬКО 3 АВТОРА) ===
async function loadSidebarTopAuthors() {
  const container = document.getElementById("top-authors-list");
  // Если контейнера нет (например, в профиле), выходим
  if (!container) return;

  try {
    const res = await fetch("/api/top-users");
    const users = await res.json();

    container.innerHTML = "";

    // ВАЖНО: .slice(0, 3) берет только первых трех авторов из 5
    users.slice(0, 3).forEach((u, index) => {
      // Цвета для 1, 2, 3 места
      let rankColor = "#888";
      if (index === 0) rankColor = "#ffd700"; // Золото
      else if (index === 1) rankColor = "#c0c0c0"; // Серебро
      else if (index === 2) rankColor = "#cd7f32"; // Бронза

      container.innerHTML += `
        <li onclick="window.location.href='profile.html?id=${
          u.id
        }'" style="cursor: pointer; display: flex; align-items: center; margin-bottom: 12px;">
            <div class="blog-rank" style="color:${rankColor}; width: 20px; font-weight: bold; text-align: center; margin-right: 10px;">${
        index + 1
      }</div>
            <div class="blog-avatar">
                <img src="${
                  u.avatar_url || "https://placehold.co/40"
                }" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; margin-right: 10px; background-color: #333;">
            </div>
            <div class="blog-info">
                <div class="name" style="font-weight: 600; font-size: 13px;">${
                  u.name
                }</div>
                <div class="subs" style="color: #8a8a8a; font-size: 11px;">${
                  u.followers_count
                } подписчиков</div>
            </div>
        </li>
      `;
    });
  } catch (e) {
    console.error(e);
  }
}

// === ПОЛНОЭКРАННЫЙ ПРОСМОТР ИЗОБРАЖЕНИЙ ===
let currentFullscreenImages = [];
let currentFullscreenIndex = 0;

function openFullscreenViewer(images, startIndex = 0) {
  if (!images || images.length === 0) return;

  currentFullscreenImages = images;
  currentFullscreenIndex = startIndex;

  const viewer = document.getElementById("fullscreen-viewer");
  const img = document.getElementById("fullscreen-image");
  const counter = document.getElementById("fullscreen-counter");

  if (!viewer || !img || !counter) return;

  img.src = currentFullscreenImages[currentFullscreenIndex];
  counter.innerText = `${currentFullscreenIndex + 1} / ${currentFullscreenImages.length}`;

  viewer.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeFullscreenViewer() {
  const viewer = document.getElementById("fullscreen-viewer");
  if (viewer) {
    viewer.classList.remove("open");
    document.body.style.overflow = "";
  }
}

function showFullscreenImage(index) {
  // Зацикливание
  if (index < 0) {
    index = currentFullscreenImages.length - 1;
  } else if (index >= currentFullscreenImages.length) {
    index = 0;
  }

  currentFullscreenIndex = index;

  const img = document.getElementById("fullscreen-image");
  const counter = document.getElementById("fullscreen-counter");

  if (img) img.src = currentFullscreenImages[currentFullscreenIndex];
  if (counter) counter.innerText = `${currentFullscreenIndex + 1} / ${currentFullscreenImages.length}`;
}

// Обработчики для полноэкранного просмотра
document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("fullscreen-close-btn");
  const prevBtn = document.getElementById("fullscreen-prev");
  const nextBtn = document.getElementById("fullscreen-next");
  const viewer = document.getElementById("fullscreen-viewer");

  if (closeBtn) {
    closeBtn.onclick = closeFullscreenViewer;
  }

  if (prevBtn) {
    prevBtn.onclick = () => showFullscreenImage(currentFullscreenIndex - 1);
  }

  if (nextBtn) {
    nextBtn.onclick = () => showFullscreenImage(currentFullscreenIndex + 1);
  }

  // Закрытие по клику на фон
  if (viewer) {
    viewer.onclick = (e) => {
      if (e.target === viewer) {
        closeFullscreenViewer();
      }
    };
  }

  // Клавиатурная навигация
  document.addEventListener("keydown", (e) => {
    // Обработка ESC для закрытия окон
    if (e.key === "Escape") {
      // Приоритет 1: Закрыть полноэкранный просмотр изображений
      const fullscreenViewer = document.getElementById("fullscreen-viewer");
      if (fullscreenViewer && fullscreenViewer.classList.contains("open")) {
        closeFullscreenViewer();
        return;
      }

      // Приоритет 2: Закрыть окно просмотра поста
      const postViewer = document.getElementById("post-viewer-modal");
      if (postViewer && postViewer.classList.contains("open")) {
        postViewer.classList.remove("open");
        return;
      }
    }

    // Навигация в полноэкранном режиме
    const viewer = document.getElementById("fullscreen-viewer");
    if (viewer && viewer.classList.contains("open")) {
      if (e.key === "ArrowLeft") {
        showFullscreenImage(currentFullscreenIndex - 1);
      } else if (e.key === "ArrowRight") {
        showFullscreenImage(currentFullscreenIndex + 1);
      }
    }
  });

  // Навигация колесиком мыши
  document.addEventListener("wheel", (e) => {
    const viewer = document.getElementById("fullscreen-viewer");
    if (!viewer || !viewer.classList.contains("open")) return;

    e.preventDefault();

    if (e.deltaY > 0) {
      // Прокрутка вниз - следующее изображение
      showFullscreenImage(currentFullscreenIndex + 1);
    } else if (e.deltaY < 0) {
      // Прокрутка вверх - предыдущее изображение
      showFullscreenImage(currentFullscreenIndex - 1);
    }
  }, { passive: false });
});

// Функция для управления кнопкой "Назад"
function setupBackButton() {
  const backBtn = document.getElementById("btn-back-header");
  if (!backBtn) return;

  // Проверяем, есть ли история навигации
  const navigationHistory = sessionStorage.getItem("navigationHistory");

  // Показываем кнопку, если есть история или если это не главная страница
  const currentPage = window.location.pathname;
  const isMainPage = currentPage.endsWith("index.html") || currentPage === "/";

  if (navigationHistory || !isMainPage) {
    backBtn.style.display = "flex";
  }

  // Обработчик клика на кнопку "Назад"
  backBtn.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "index.html";
    }
  });
}

// Сохраняем историю навигации
window.addEventListener("beforeunload", () => {
  sessionStorage.setItem("navigationHistory", "true");
});
