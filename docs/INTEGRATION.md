# mdBook Integration

The guide can stay on GitHub Pages. Add the widget assets to the mdBook
theme and point the browser at the backend.

In `docs/acton-guide/book.toml`:

```toml
[output.html]
additional-css = [
  "theme/ask-acton.css",
]
additional-js = [
  "theme/ask-acton-config.js",
  "theme/ask-acton.js",
]
```

`ask-acton-config.js` should set the API URL before the widget loads:

```js
window.ASK_ACTON_API_URL = "https://ask.acton.guide/api/ask";
```

Copy `public/ask-acton.js` and `public/ask-acton.css` into the guide
theme directory when we are ready to enable the feature on the site.
