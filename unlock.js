// Unlocks a page's encrypted content with the team password (see scripts/plays-crypt.mjs). Every
// page is encrypted with the same salt, so the key remembered on this device unlocks all of them
// and players only enter the password once.
(function () {
  const KEY_STORAGE = 'lesher-plays-key';
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function deriveKey(encrypted, password) {
    const { salt, iterations } = encrypted;
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: bytes(salt), iterations, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, true, ['decrypt'],
    );
  }

  async function decrypt(encrypted, key) {
    const { iv, data } = encrypted;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, key, bytes(data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Shows the page's .unlock form until the content decrypts, then hands it ({ html, script }) to
  // onUnlock.
  window.unlockPage = async function (encrypted, onUnlock) {
    const form = document.querySelector('.unlock');
    if (!encrypted) {
      // The page's .enc.js hasn't been generated yet (see scripts/plays-crypt.mjs).
      form.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Nothing has been published here yet.' }));
      form.hidden = false;
      return;
    }

    try {
      const saved = localStorage.getItem(KEY_STORAGE);
      if (saved) {
        const key = await crypto.subtle.importKey('raw', bytes(saved), 'AES-GCM', true, ['decrypt']);
        onUnlock(await decrypt(encrypted, key));
        return;
      }
    } catch {
      // Saved key is missing or no longer matches (e.g. the password changed); ask again.
    }
    form.hidden = false;
    form.querySelector('input').focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      form.querySelector('.unlock-error').hidden = true;
      try {
        const key = await deriveKey(encrypted, form.querySelector('input').value);
        onUnlock(await decrypt(encrypted, key));
        form.hidden = true;
        try {
          const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
          localStorage.setItem(KEY_STORAGE, btoa(String.fromCharCode(...raw)));
        } catch {
          // Can't remember the key (e.g. private browsing); they'll enter it next time.
        }
      } catch {
        form.querySelector('.unlock-error').hidden = false;
      } finally {
        button.disabled = false;
      }
    });
  };
})();
