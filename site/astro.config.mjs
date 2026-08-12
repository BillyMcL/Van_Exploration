import { defineConfig } from 'astro/config';

// Pages de projet : le site est servi sous /Van_Exploration/ et non à la racine
// du domaine. Oublier `base` produit un site dont tous les liens internes cassent
// une fois publié tout en fonctionnant en local.
export default defineConfig({
  site: 'https://billymcl.github.io',
  base: '/Van_Exploration',
  trailingSlash: 'ignore',
  build: {
    // Pas de JavaScript embarqué par défaut : les données sont rendues au build.
    inlineStylesheets: 'auto',
  },
});
