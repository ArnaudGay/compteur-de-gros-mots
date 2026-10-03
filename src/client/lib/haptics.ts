// Retour haptique. Android : API de vibration. iPhone (iOS 18 et plus) : Safari n'a pas
// l'API de vibration, mais basculer un interrupteur natif <input type="checkbox" switch>
// déclenche le Taptic Engine. Ça ne marche que pendant un geste de l'utilisateur.

let label: HTMLLabelElement | null = null;

function ensureSwitch(): HTMLLabelElement {
  if (label) return label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'gm-haptic';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  label = document.createElement('label');
  label.htmlFor = input.id;
  label.setAttribute('aria-hidden', 'true');
  for (const el of [input, label]) {
    Object.assign(el.style, { position: 'fixed', left: '-100px', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  }
  document.body.append(input, label);
  return label;
}

export function haptic(): void {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(12);
      return;
    }
    ensureSwitch().click();
  } catch {
    // Pas de retour haptique sur cet appareil : ce n'est pas grave.
  }
}
