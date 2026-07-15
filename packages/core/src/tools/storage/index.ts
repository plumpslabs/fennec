import { z } from 'zod';
import { createTool } from '../_registry.js';
import type { CookieInput } from '../../browser/types.js';

export const storageGetLocal = createTool({
  name: 'storage_get_local',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> 💽 Get a localStorage value by key. If no key provided, returns ALL localStorage items as an object. Also returns size (number of items or value length). Use to read stored app data, configs, tokens in localStorage. For session-only data, use storage_get_session instead.`',
  inputSchema: z.object({
    key: z.string().optional().describe('localStorage key to retrieve'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      if (input.key) {
        const value = await session.browser.evaluate(
          (k: string) => localStorage.getItem(k),
          input.key,
        );
        return responseBuilder.success(
          { value, size: value?.length ?? 0 },
          sessionManager.buildMeta(session),
        );
      } else {
        const allItems = await session.browser.evaluate(() => {
          const ls = window.localStorage;
          const items: Record<string, string> = {};
          for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i);
            if (key) items[key] = ls.getItem(key) ?? '';
          }
          return items;
        });
        return responseBuilder.success(
          { allItems, size: Object.keys(allItems).length },
          sessionManager.buildMeta(session),
        );
      }
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'STORAGE_ACCESS_DENIED',
        suggestions: [
          'localStorage may be restricted in private browsing or cross-origin contexts',
        ],
      });
    }
  },
});

export const storageSetLocal = createTool({
  name: 'storage_set_local',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> ✏️ Set a localStorage value by key. Returns the previous value (if any). Use to modify app state, inject configs, or set auth tokens. Be careful — changing localStorage can affect app behavior. For removing keys, use storage_remove_local; for wiping all, use storage_clear_local.`',
  inputSchema: z.object({
    key: z.string().describe('localStorage key'),
    value: z.string().describe('Value to store'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const previousValue = await session.browser.evaluate(
        (k: string) => localStorage.getItem(k),
        input.key as string,
      );
      await session.browser.evaluate(
        (args: { k: string; v: string }) => localStorage.setItem(args.k, args.v),
        { k: input.key as string, v: input.value as string },
      );
      return responseBuilder.success({ previousValue }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, { code: 'STORAGE_ACCESS_DENIED' });
    }
  },
});

export const storageRemoveLocal = createTool({
  name: 'storage_remove_local',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> 🗑️ Remove a specific localStorage key and its value. Returns success. Use to clean up specific stored data without affecting other keys. For bulk clearing, use storage_clear_local instead.`',
  inputSchema: z.object({
    key: z.string().describe('localStorage key to remove'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.browser.evaluate((k: string) => localStorage.removeItem(k), input.key);
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, { code: 'STORAGE_ACCESS_DENIED' });
    }
  },
});

export const storageClearLocal = createTool({
  name: 'storage_clear_local',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> 🧹 Clear ALL localStorage data for the current origin. Returns clearedCount (number of items removed). Use when you need a completely fresh storage state — e.g., after logout, before testing, or to reset app state. Warning: This removes ALL keys, not just specific ones. Use storage_remove_local for selective removal.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const count = await session.browser.evaluate(() => {
        const storage = window.localStorage;
        const n = storage.length;
        storage.clear();
        return n;
      });
      return responseBuilder.success({ clearedCount: count }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, { code: 'STORAGE_ACCESS_DENIED' });
    }
  },
});

export const storageGetSession = createTool({
  name: 'storage_get_session',
  category: 'storage',
  description:
    "`<use_case>Browser storage</use_case> 🔄 Get a sessionStorage value by key (or all items if no key). sessionStorage is per-tab and cleared when the tab closes. Use for tab-specific data that doesn't persist. Same behavior as storage_get_local but for session-only storage.`",
  inputSchema: z.object({
    key: z.string().optional().describe('sessionStorage key to retrieve'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      if (input.key) {
        const value = await session.browser.evaluate(
          (k: string) => sessionStorage.getItem(k),
          input.key,
        );
        return responseBuilder.success({ value }, sessionManager.buildMeta(session));
      } else {
        const allItems = await session.browser.evaluate(() => {
          const ss = window.sessionStorage;
          const items: Record<string, string> = {};
          for (let i = 0; i < ss.length; i++) {
            const key = ss.key(i);
            if (key) items[key] = ss.getItem(key) ?? '';
          }
          return items;
        });
        return responseBuilder.success({ allItems }, sessionManager.buildMeta(session));
      }
    } catch (error) {
      return responseBuilder.error(error, { code: 'STORAGE_ACCESS_DENIED' });
    }
  },
});

export const storageSetSession = createTool({
  name: 'storage_set_session',
  category: 'storage',
  description:
    "`<use_case>Browser storage</use_case> ✏️ Set a sessionStorage value by key. Session data is per-tab and cleared when the tab closes. Use for temporary tab-specific data that shouldn't persist across sessions. Similar to storage_set_local but data only lives as long as the tab.`",
  inputSchema: z.object({
    key: z.string().describe('sessionStorage key'),
    value: z.string().describe('Value to store'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.browser.evaluate(
        (args: { k: string; v: string }) => sessionStorage.setItem(args.k, args.v),
        { k: input.key as string, v: input.value as string },
      );
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, { code: 'STORAGE_ACCESS_DENIED' });
    }
  },
});

export const storageGetCookies = createTool({
  name: 'storage_get_cookies',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> 🍪 Get browser cookies for the current context. Filter by cookie name or domain. Returns cookies[] with name, value, domain, path, httpOnly, secure, sameSite, expiry. Use to inspect auth cookies, session tokens, or any cookie set by the page. For auth-specific cookie checking, use auth_check_logged_in or diagnose_auth instead.`',
  inputSchema: z.object({
    name: z.string().optional().describe('Filter by cookie name'),
    domain: z.string().optional().describe('Filter by cookie domain'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const ctx = session.browser;
      const cookies = await ctx.contextCookies();

      let filtered = cookies;
      if (input.name) {
        const name = input.name;
        filtered = filtered.filter((c) => c.name === name);
      }
      if (input.domain) {
        const domain = input.domain;
        filtered = filtered.filter((c) => c.domain.includes(domain));
      }

      return responseBuilder.success(
        {
          cookies: filtered,
          count: filtered.length,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const storageSetCookie = createTool({
  name: 'storage_set_cookie',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> 🍪➕ Set a browser cookie with full control: name, value, domain, path, httpOnly, secure, sameSite flags. Use for manually injecting auth state, setting session cookies, or configuring cookies for testing. For saving/loading complete auth states, use auth_save_session / auth_load_session instead.`',
  inputSchema: z.object({
    name: z.string().describe('Cookie name'),
    value: z.string().describe('Cookie value'),
    domain: z.string().optional().describe('Cookie domain'),
    path: z.string().optional().describe('Cookie path'),
    httpOnly: z.boolean().optional().describe('HTTP-only flag'),
    secure: z.boolean().optional().describe('Secure flag'),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional().describe('SameSite policy'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.browser.contextAddCookies([
        {
          name: input.name,
          value: input.value,
          domain: input.domain,
          path: input.path ?? '/',
          httpOnly: input.httpOnly,
          secure: input.secure,
          sameSite: input.sameSite,
          url: input.domain ? undefined : session.browser.url(),
        },
      ]);
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const storageDeleteCookie = createTool({
  name: 'storage_delete_cookie',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> 🍪🗑️ Delete a browser cookie by name and optional domain. Returns success. Use to remove specific cookies (like forcing a logout by deleting the session cookie). For bulk cookie management, use storage_get_cookies to list first.`',
  inputSchema: z.object({
    name: z.string().describe('Cookie name to delete'),
    domain: z.string().optional().describe('Cookie domain'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const url = session.browser.url();
      await session.browser.contextClearCookies();
      // Re-add all cookies except the one to delete
      const cookies = await session.browser.contextCookies();
      const filtered = cookies.filter((c) => c.name !== input.name);
      if (filtered.length > 0) {
        await session.browser.contextAddCookies(
          filtered.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite as 'Strict' | 'Lax' | 'None' | undefined,
          })),
        );
      }
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const storageGetIndexedDB = createTool({
  name: 'storage_get_indexeddb',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> 🗄️ Get IndexedDB database info. Lists all databases, their object stores, and optionally records from a specific store (if dbName + storeName provided). Use for inspecting offline-first apps, cache storage, or any app using IndexedDB for client-side data persistence. More complex than localStorage — use storage_get_local first for simpler storage.`',
  inputSchema: z.object({
    dbName: z.string().optional().describe('Database name'),
    storeName: z.string().optional().describe('Object store name (requires dbName)'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const dbName = input.dbName ?? null;
      const storeName = input.storeName ?? null;
      const result = await session.browser.evaluate(
        ({ dbName: db, storeName: store }: { dbName: string | null; storeName: string | null }) => {
          return new Promise<{
            databases: Array<{ name: string; version: number; stores: string[] }>;
            records?: unknown[];
          }>((resolve, reject) => {
            if (!db) {
              const dbsList = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
              dbsList
                .then((dbs) => {
                  resolve({
                    databases: dbs.map((dbEntry) => ({
                      name: dbEntry.name ?? 'unknown',
                      version: dbEntry.version ?? 0,
                      stores: [],
                    })),
                  });
                })
                .catch(reject);
              return;
            }

            const request = indexedDB.open(db);
            request.onsuccess = () => {
              const dbResult = request.result;
              const storeNames = Array.from(dbResult.objectStoreNames);

              const databases = [
                {
                  name: db,
                  version: dbResult.version,
                  stores: storeNames,
                },
              ];

              let records: unknown[] | undefined;

              if (store && storeNames.includes(store)) {
                const transaction = dbResult.transaction(store, 'readonly');
                const objStore = transaction.objectStore(store);
                const getAll = objStore.getAll();
                getAll.onsuccess = () => {
                  records = getAll.result;
                  dbResult.close();
                  resolve({ databases, records });
                };
                getAll.onerror = () => {
                  dbResult.close();
                  resolve({ databases, records: [] });
                };
              } else {
                dbResult.close();
                resolve({ databases });
              }
            };

            request.onerror = () => {
              reject(new Error(`Failed to open database: ${db}`));
            };
          });
        },
        { dbName, storeName },
      );

      return responseBuilder.success(result, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        suggestions: ['IndexedDB may not be available on all pages'],
      });
    }
  },
});

// ─── Storage Export / Import ─────────────────────────────────────

export const storageExportState = createTool({
  name: 'storage_export_state',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> 📦 Export ALL browser state (cookies, localStorage, sessionStorage) to a JSON object. Optionally save to a file on disk. Returns cookies[], localStorage, sessionStorage, origin, savedAt. Use for snapshotting auth state before logout, backing up form data, or capturing state for debugging. Can be re-imported with storage_import_state.`',
  inputSchema: z.object({
    filePath: z.string().optional().describe('Optional file path to save the state to'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const cookies = await session.browser.contextCookies();
      const origin = session.browser.url();

      const localStorageData = await session.browser
        .evaluate(() => {
          const ls = window.localStorage;
          const items: Record<string, string> = {};
          for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i);
            if (key) items[key] = ls.getItem(key) ?? '';
          }
          return items;
        })
        .catch(() => ({}) as Record<string, string>);

      const sessionStorageData = await session.browser
        .evaluate(() => {
          const ss = window.sessionStorage;
          const items: Record<string, string> = {};
          for (let i = 0; i < ss.length; i++) {
            const key = ss.key(i);
            if (key) items[key] = ss.getItem(key) ?? '';
          }
          return items;
        })
        .catch(() => ({}) as Record<string, string>);

      const state = {
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })),
        localStorage: localStorageData,
        sessionStorage: sessionStorageData,
        origin,
        savedAt: new Date().toISOString(),
      };

      if (input.filePath) {
        const { writeFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const exportDir = config.security.exportPath;
        const fullPath = resolve(exportDir, input.filePath);
        writeFileSync(fullPath, JSON.stringify(state, null, 2), 'utf-8');
        return responseBuilder.success(
          { ...state, savedTo: fullPath },
          sessionManager.buildMeta(session),
        );
      }

      return responseBuilder.success(state, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'STORAGE_ACCESS_DENIED',
        suggestions: ['Storage export may be restricted in cross-origin contexts'],
      });
    }
  },
});

export const storageImportState = createTool({
  name: 'storage_import_state',
  category: 'storage',
  description:
    '`<use_case>Browser storage</use_case> 📥 Import browser state previously exported with storage_export_state. Takes either a JSON file path or a JSON string object. Restores cookies, localStorage, and sessionStorage. Returns cookiesRestored and itemsRestored counts. Use to restore auth sessions, replay test scenarios, or migrate state between browsers.`',
  inputSchema: z.object({
    filePath: z.string().optional().describe('File path to load state from'),
    stateObject: z
      .string()
      .optional()
      .describe('JSON string of state object (alternative to filePath)'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      let state: any;

      if (input.stateObject) {
        state = JSON.parse(input.stateObject);
      } else if (input.filePath) {
        const { readFileSync, existsSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const exportDir = config.security.exportPath;
        const fullPath = resolve(exportDir, input.filePath);
        if (!existsSync(fullPath)) {
          return responseBuilder.error(new Error(`State file not found: ${fullPath}`), {
            code: 'STATE_FILE_NOT_FOUND',
          });
        }
        state = JSON.parse(readFileSync(fullPath, 'utf-8'));
      } else {
        return responseBuilder.error(new Error('Either filePath or stateObject is required'), {
          code: 'INVALID_INPUT',
        });
      }

      // Restore cookies
      if (state.cookies && state.cookies.length > 0) {
        await session.browser.contextAddCookies(
          state.cookies.map((c: CookieInput) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path ?? '/',
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite,
          })),
        );
      }

      // Navigate to origin if different
      if (state.origin && session.browser.url() !== state.origin) {
        await session.browser.navigate(state.origin).catch(() => {});
      }

      // Restore localStorage
      let itemsRestored = 0;
      if (state.localStorage) {
        for (const [key, value] of Object.entries(state.localStorage)) {
          await session.browser
            .evaluate((args: { k: string; v: string }) => localStorage.setItem(args.k, args.v), {
              k: key as string,
              v: value as string,
            })
            .catch(() => {});
          itemsRestored++;
        }
      }

      // Restore sessionStorage
      if (state.sessionStorage) {
        for (const [key, value] of Object.entries(state.sessionStorage)) {
          await session.browser
            .evaluate((args: { k: string; v: string }) => sessionStorage.setItem(args.k, args.v), {
              k: key as string,
              v: value as string,
            })
            .catch(() => {});
          itemsRestored++;
        }
      }

      return responseBuilder.success(
        {
          cookiesRestored: state.cookies?.length ?? 0,
          itemsRestored,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'STORAGE_ACCESS_DENIED',
        suggestions: ['Verify the file path or JSON string is valid'],
      });
    }
  },
});
