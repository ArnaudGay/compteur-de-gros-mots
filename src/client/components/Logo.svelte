<script lang="ts">
  let { size = 22 }: { size?: number } = $props();
</script>

<!-- Un carton jaune tenu de travers, avec un juron de bande dessinée. -->
<svg class="logo" width={size} height={size * 1.25} viewBox="0 0 20 25" aria-hidden="true">
  <g transform="rotate(-9 10 12.5)">
    <rect x="2.5" y="2" width="15" height="21" rx="1.6" fill="var(--card)" />
    <text x="10" y="15.2" text-anchor="middle" font-family="var(--font-display)" font-weight="900" font-size="7.4" fill="var(--card-ink)">#@!</text>
  </g>
</svg>

<style>
  .logo {
    display: block;
    flex: none;
  }
</style>
