<script lang="ts">
  import type { Toast } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  let { toast, onDismiss }: { toast: Toast | null; onDismiss: () => void } = $props();
</script>

<div class="zone" aria-live="polite" aria-atomic="true">
  {#if toast}
    {#key toast.id}
      <div class="toast {toast.tone}" role="status">
        <div class="text">
          <strong>{toast.title}</strong>
          {#if toast.detail}<span>{toast.detail}</span>{/if}
        </div>
        {#if toast.actions.length}
          <div class="actions">
            {#each toast.actions as action (action.label)}
              <button
                type="button"
                class="action"
                class:primary={action.primary}
                onclick={() => {
                  onDismiss();
                  void action.run();
                }}>{action.label}</button
              >
            {/each}
          </div>
        {:else}
          <button type="button" class="close" aria-label="Masquer le message" onclick={onDismiss}><Icon name="close" size={18} /></button>
        {/if}
        <span class="timer" style:animation-duration="{toast.duration}ms"></span>
      </div>
    {/key}
  {/if}
</div>

<style>
  .zone {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 10px;
    z-index: 50;
    pointer-events: none;
  }
  .toast {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    padding: 12px 12px 14px 14px;
    border-radius: 10px;
    background: var(--toast);
    color: var(--toast-ink);
    pointer-events: auto;
    overflow: hidden;
    animation: enter 220ms var(--ease);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
  @keyframes enter {
    from {
      transform: translateY(14px);
      opacity: 0;
    }
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  strong {
    font-size: var(--t-lg);
    line-height: 1.25;
  }
  .point strong {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 1.6rem;
    letter-spacing: 0.02em;
    line-height: 1;
  }
  .text span {
    font-size: var(--t-sm);
    opacity: 0.85;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex: none;
    margin-left: auto;
  }
  .action {
    min-height: 36px;
    padding: 0 12px;
    border-radius: var(--radius);
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    font-weight: 700;
    font-size: var(--t-sm);
    white-space: nowrap;
  }
  .action.primary {
    background: var(--card);
    border-color: var(--card);
    color: var(--card-ink);
  }
  .close {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: inherit;
    opacity: 0.7;
  }
  /* Le temps restant pour annuler. */
  .timer {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    width: 100%;
    background: var(--card);
    transform-origin: left;
    animation: shrink linear forwards;
  }
  .error .timer {
    background: rgb(255 255 255 / 0.6);
  }
  @keyframes shrink {
    to {
      transform: scaleX(0);
    }
  }
</style>
