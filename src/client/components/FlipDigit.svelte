<script lang="ts">
  // Un chiffre à volets, comme sur les tableaux d'affichage : quand il change, le volet du
  // haut tombe et découvre le nouveau chiffre.
  let { digit }: { digit: string } = $props();

  let shown = $state('');
  let from = $state('');
  let flipping = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = true;

  $effect(() => {
    const next = digit;
    if (first) {
      first = false;
      shown = next;
      from = next;
      return;
    }
    if (next === shown) return;
    from = shown;
    shown = next;
    flipping = false;
    requestAnimationFrame(() => {
      flipping = true;
    });
    clearTimeout(timer);
    timer = setTimeout(() => {
      flipping = false;
    }, 460);
  });
</script>

<span class="digit" class:one={shown === '1'} aria-hidden="true">
  <span class="half top">{shown}</span>
  <span class="half bottom">{flipping ? from : shown}</span>
  {#if flipping}
    <span class="flap fall">{from}</span>
    <span class="flap rise">{shown}</span>
  {/if}
  <span class="seam"></span>
</span>

<style>
  .digit {
    position: relative;
    display: inline-block;
    width: 0.53em;
    height: 1em;
    perspective: 2.5em;
  }
  .digit.one {
    width: 0.36em;
  }
  .half,
  .flap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    backface-visibility: hidden;
  }
  .top,
  .fall {
    clip-path: inset(0 0 50% 0);
  }
  .bottom,
  .rise {
    clip-path: inset(50% 0 0 0);
  }
  .fall {
    transform-origin: 50% 50%;
    animation: fall 200ms cubic-bezier(0.55, 0, 0.9, 0.4) forwards;
  }
  .rise {
    transform-origin: 50% 50%;
    transform: rotateX(90deg);
    animation: rise 220ms 190ms cubic-bezier(0.1, 0.6, 0.3, 1) forwards;
  }
  /* Le joint horizontal des volets. */
  .seam {
    position: absolute;
    left: -0.02em;
    right: -0.02em;
    top: calc(50% - 0.5px);
    height: 1.5px;
    background: var(--tile-bg, var(--panel));
    transition: background-color 600ms;
  }
  @keyframes fall {
    to {
      transform: rotateX(-90deg);
    }
  }
  @keyframes rise {
    to {
      transform: rotateX(0deg);
    }
  }
</style>
