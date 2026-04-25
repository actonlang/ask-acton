(function () {
  const apiUrl = window.ASK_ACTON_API_URL || "https://ask.acton.guide/api/ask";
  const maxExcerptLength = 5000;
  const history = [];

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  ready(() => {
    const root = document.createElement("div");
    root.className = "ask-acton";
    root.innerHTML = [
      '<button class="ask-acton__button" type="button" aria-expanded="false">Ask Acton</button>',
      '<section class="ask-acton__panel" aria-label="Ask Acton" hidden>',
      '  <header class="ask-acton__header">',
      "    <strong>Ask Acton</strong>",
      '    <button class="ask-acton__close" type="button" aria-label="Close Ask Acton">x</button>',
      "  </header>",
      '  <div class="ask-acton__messages" role="log" aria-live="polite"></div>',
      '  <form class="ask-acton__form">',
      '    <textarea class="ask-acton__input" name="question" rows="4" placeholder="Ask about Acton, or paste code and an error message"></textarea>',
      '    <button class="ask-acton__send" type="submit">Ask</button>',
      "  </form>",
      '  <p class="ask-acton__notice">Do not paste secrets. Questions may be sent to the Acton guide backend and OpenAI.</p>',
      "</section>"
    ].join("");

    document.body.appendChild(root);

    const button = root.querySelector(".ask-acton__button");
    const panel = root.querySelector(".ask-acton__panel");
    const close = root.querySelector(".ask-acton__close");
    const form = root.querySelector(".ask-acton__form");
    const input = root.querySelector(".ask-acton__input");
    const messages = root.querySelector(".ask-acton__messages");

    button.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question) {
        input.focus();
        return;
      }

      input.value = "";
      addMessage(messages, "user", question);
      setBusy(root, true);

      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            question,
            page: currentPageContext(),
            history: history.slice(-8)
          })
        });

        if (!response.ok) {
          throw new Error(`Ask Acton returned ${response.status}`);
        }

        const data = await response.json();
        const answer = data.answer || "I could not produce an answer.";
        history.push({ role: "user", content: question });
        history.push({ role: "assistant", content: answer });
        addMessage(messages, "assistant", answer);
      } catch (error) {
        addMessage(messages, "assistant", "Ask Acton is unavailable right now. Try again later.");
        console.error(error);
      } finally {
        setBusy(root, false);
        input.focus();
      }
    });

    function setOpen(open) {
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open) {
        input.focus();
      }
    }
  });

  function currentPageContext() {
    const main = document.querySelector("main") || document.body;
    const text = main.innerText.replace(/\s+/g, " ").trim();
    return {
      url: window.location.href,
      title: document.title,
      excerpt: text.slice(0, maxExcerptLength)
    };
  }

  function addMessage(container, role, text) {
    const message = document.createElement("article");
    message.className = `ask-acton__message ask-acton__message--${role}`;
    const label = document.createElement("strong");
    label.textContent = role === "user" ? "You" : "Ask Acton";
    const body = document.createElement("p");
    body.textContent = text;
    message.append(label, body);
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
  }

  function setBusy(root, busy) {
    root.classList.toggle("ask-acton--busy", busy);
    root.querySelector(".ask-acton__send").disabled = busy;
  }
})();
