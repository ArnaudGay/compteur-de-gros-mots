// Spécificités de l'app installée : écran d'accueil, service worker, notifications, pastille.

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Navigateur intégré d'une autre app (WhatsApp, Messenger, Instagram…) : pas d'installation possible. */
export function isInAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|GSA\//.test(navigator.userAgent);
}

export function canInstall(): boolean {
  return isIOS() && !isStandalone();
}

let updateReady = false;

/** Enregistre le service worker ; une nouvelle version s'applique au prochain retour dans l'app. */
export function registerServiceWorker(): void {
  if (__DEMO__ || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) updateReady = true;
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
      });
    })
    .catch(() => undefined);
  // Recharge seulement quand l'app revient au premier plan, jamais en plein milieu d'un tap.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && updateReady) {
      updateReady = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      void navigator.serviceWorker.getRegistration().then((r) => r?.waiting?.postMessage('skip-waiting'));
    }
  });
}

export type PushSupport = 'ok' | 'install-first' | 'unsupported' | 'denied';

export function pushSupport(): PushSupport {
  if (__DEMO__) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'install-first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** À appeler depuis un tap (iOS l'exige pour demander la permission). */
export async function subscribePush(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error("Les notifications sont refusées. Autorise-les dans Réglages › Notifications › Gros mots.");
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  return subscription.toJSON();
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (__DEMO__ || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  return subscription?.endpoint ?? null;
}

export async function unsubscribePush(): Promise<string | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

/** Pastille sur l'icône de l'app (votes en attente). */
export function setBadge(count: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    // non pris en charge
  }
}

/** Partage via la feuille de partage d'iOS, sinon copie dans le presse-papiers. */
export async function shareLink(title: string, text: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return 'shared';
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
