<script lang="ts">
  import Back from '../components/Back.svelte';
  import InstallGuide from '../components/InstallGuide.svelte';
</script>

<div class="page">
  <Back />
  <h1>Installer l'app</h1>
  <p class="lede">Une fois sur l'écran d'accueil, Gros mots s'ouvre en plein écran comme une vraie app : notifications, pastille sur l'icône et Face ID en plus.</p>
  <div class="card"><InstallGuide /></div>
</div>

<style>
  .card {
    padding: 18px 16px;
    border-radius: var(--radius-lg);
    background: var(--panel);
    border: 1px solid var(--rule);
  }
</style>
