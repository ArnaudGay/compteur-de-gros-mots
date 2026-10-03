<script lang="ts">
  // Pavé numérique façon écran de verrouillage : pas de clavier iOS qui cache l'écran.
  import { haptic } from '../lib/haptics';
  import Icon from './Icon.svelte';

  let {
    length = 6,
    busy = false,
    error = null,
    onComplete,
  }: { length?: number; busy?: boolean; error?: string | null; onComplete: (code: string) => void } = $props();

  let code = $state('');
  let shake = $state(0);
  let lastError: string | null = null;

  $effect(() => {
    // À chaque nouvelle erreur : on vide et on secoue.
    if (error && error !== lastError) {
      code = '';
      shake += 1;
    }
    lastError = error;
  });

  function press(digit: string) {
    if (busy || code.length >= length) return;
    haptic();
    code += digit;
    if (code.length === length) {
      const value = code;
      setTimeout(() => onComplete(value), 120);
    }
  }

  function erase() {
    if (busy) return;
    code = code.slice(0, -1);
  }

  function onKey(event: KeyboardEvent) {
    if (/^\d$/.test(event.key)) press(event.key);
    else if (event.key === 'Backspace') erase();
  }

  /** Après une erreur ou une étape, le parent peut vider le code. */
  export function reset() {
    code = '';
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="keypad">
  {#key shake}
    <div class="dots" class:shake={shake > 0} aria-label="{code.length} chiffre{code.length > 1 ? 's' : ''} sur {length}" role="status">
      {#each Array.from({ length }) as _, i (i)}
        <span class="dot" class:filled={i < code.length}></span>
      {/each}
    </div>
  {/key}
  <p class="error" role="alert">{error ?? ''}</p>
  <div class="keys">
    {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as digit (digit)}
      <button type="button" class="key" onclick={() => press(digit)} disabled={busy}>{digit}</button>
    {/each}
    <span></span>
    <button type="button" class="key" onclick={() => press('0')} disabled={busy}>0</button>
    <button type="button" class="key erase" onclick={erase} aria-label="Effacer" disabled={busy || code.length === 0}>
      <Icon name="back" size={26} />
    </button>
  </div>
</div>

<style>
  .keypad {
    display: grid;
    justify-items: center;
    gap: 10px;
  }
  .dots {
    display: flex;
    gap: 14px;
    padding: 6px 0;
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--ink);
    transition: background-color 100ms;
  }
  .dot.filled {
    background: var(--ink);
  }
  .shake {
    animation: shake 380ms ease-in-out;
  }
  @keyframes shake {
    20%,
    60% {
      transform: translateX(-9px);
    }
    40%,
    80% {
      transform: translateX(9px);
    }
  }
  .error {
    min-height: 1.4em;
    margin: 0;
    color: var(--danger);
    font-size: var(--t-sm);
    font-weight: 600;
    text-align: center;
  }
  .keys {
    display: grid;
    grid-template-columns: repeat(3, 76px);
    gap: 14px 24px;
  }
  .key {
    width: 76px;
    height: 76px;
    border-radius: 50%;
    border: 1px solid var(--rule-strong);
    background: var(--panel);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 2rem;
    line-height: 1;
    display: grid;
    place-items: center;
    user-select: none;
    -webkit-user-select: none;
    transition: background-color 80ms;
  }
  .key:active {
    background: var(--sunken);
  }
  .key:disabled {
    opacity: 0.45;
  }
  .erase {
    border-color: transparent;
    background: transparent;
  }
</style>
