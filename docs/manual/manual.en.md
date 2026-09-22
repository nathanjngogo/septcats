# Septcats User Manual

Applies to 0.3.x ｜ A local-first notes app

## Getting Started

1. **Create your first note**: press `Ctrl+N` (or menu File → New Page). A blank page appears immediately.
2. **Just type**: at the start of a line, `/` opens the slash command menu to insert headings, lists, code blocks, tables and more.
3. **No save button**: Septcats auto-saves every edit — debounced writes plus a final flush when you close the window. Close it whenever you like.
4. **Find anything**: press `Ctrl+K` for the command palette — search pages and run every command (switch theme, open settings, and more).

On first launch you will be guided to create a **workspace** — notes are isolated per workspace and everything stays on your machine; nothing is uploaded.

## Pages & Tabs

- Pages live in the left sidebar as a tree; create child pages to build any depth. Each row's ⋯ menu offers full-width toggle, regular-page ↔ wiki-page conversion and delete; double-click a title to rename.
- **Rename**: type a new name in the sidebar tree, then **click elsewhere (blur) to commit** — Enter works too, `Esc` cancels.
- **Multiple tabs**: each opened page adds a tab; `Ctrl+W` closes the current tab (never the app window); a close button appears on hover.
- **Starred & Recent**: the sidebar offers both quick views.
- **Delete & Trash**: deleted pages go to the Trash (menu File → Trash) where you can restore or purge them.

## Block Editor

- **Slash commands**: type `/` at the start of a line, then a keyword to filter block types (heading, to-do, code, table, divider…).
- **Markdown shortcuts**: `#` headings, `-` lists, `> ` quotes convert as you type; pasting Markdown from outside is recognized automatically.
- **Wiki links**: type `[[Page name` in the body to link another page (with autocomplete); the target page shows the reference under "backlinks". If the target doesn't exist you can create and link it in one step — the foundation of your personal wiki.
- **Undo & merge**: `Ctrl+Z` / `Ctrl+Shift+Z`; concurrent edits merge automatically (CRDT-based).

## Database View

Insert a **Db View** block to manage child pages as a table:

- Columns for text, number, checkbox, date, select and multi-select properties.
- Edit cells in place: type numbers, toggle checkboxes with Space/Enter, click to change.
- Sort and filter by column; changes are auto-saved as well.

## Search & Command Palette

- **Search page**: from the sidebar or menu — full-text search across the workspace with highlighted snippets.
- **Command palette**: `Ctrl+K`. Fuzzy-match any command: new page, theme, settings, AI continue/summarize/rewrite/translate, sync, import/export…

## Templates

- Save any page as a template (command palette "Save as Template" or the page menu), then create new pages from it in the Templates area.

## Import & Export

- **Import**: menu File → Import, or the ＋ button — a wizard that bulk-imports a Markdown folder, recreating pages and structure.
- **Export**: command palette "Export" writes your workspace out as a Markdown file bundle — your data can always leave in full.

## Sync (optional)

Fully **offline by default**. Enable it yourself under Settings → Sync to sync one workspace across devices (end-to-end; credentials stay in your local secret store). The top-bar sync button shows six states: off / idle / syncing / synced / offline / error.

## AI Assistant (optional)

- The ✦ button in the top bar opens the AI side panel (position configurable in layout settings: right / bottom / hidden).
- Chat plus quick actions: continue writing, summarize, rewrite, translate (select text, then run from the command palette).
- **Privacy**: cloud features are off by default; connecting a local LM Studio / Ollama endpoint (e.g. `http://127.0.0.1:1234/v1`) is recommended. No request ever leaves this machine toward a remote endpoint without your explicit consent. Keys are stored only in the OS credential vault.

## Settings

Open via the gear button in the top bar. Four sections:

- **Appearance**: theme (light / dark / system) and language (简体中文 / English / system). Language switches instantly and the native menu bar is translated too.
- **Layout**: see the next chapter.
- **AI**: endpoint, model name, key (stored in the credential vault), cloud toggle.
- **About**: version, check for updates (in-app auto-update from official sources), roll back to the previous version.

## Layout & Windows

- **Three presets**: Notion-style (sidebar + editor), Focus (sidebar hidden, narrow column), Workbench (wide column, AI panel resident).
- **Sidebar**: toggle with the button at the left end of the tab row; resizable; runs full height from under the menu bar to the bottom of the window.
- **Full width**: menu View → Toggle Full Width for wide tables and database pages.
- **Closing the window**: the ✕ button asks first — "Minimize to tray" keeps Septcats running in the background (left-click the tray icon to bring it back); "Quit" exits for real. Check "Remember my choice" to skip the prompt (reversible in settings). **Either way, unsaved edits are flushed to the database first** — you never lose data.
- **Tray right-click**: show window / quit.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New page |
| `Ctrl+W` | Close current tab |
| `Ctrl+K` | Command palette (incl. search) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `/` at line start | Slash command menu |
| `Esc` | Dismiss dialogs / cancel input |

(On macOS use `Cmd`.)

## FAQ

- **Moving to a new computer?** Export a Markdown bundle on the old machine, import it on the new one. Your data stays your files.
- **Update failed?** Settings → About offers roll-back to the previous version; logs live in the data directory (default `C:\Users\<you>\.septcats\logs`, or `~/.septcats/logs` on macOS/Linux).
- **AI not answering?** Check the endpoint in Settings → AI (for local LM Studio, make sure the server is running); error toasts explain causes, not raw codes.
- **Deleted a page by mistake?** Restore it from the Trash.
