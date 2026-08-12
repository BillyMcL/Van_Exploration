/**
 * Collection du journal de bord.
 *
 * Les entrées ne sont pas rédigées ici : elles vivent dans le dépôt privé et
 * n'arrivent dans `data/derive/journal/` que lorsque l'horloge de l'itinéraire
 * les y autorise. Ce dossier est reconstruit à chaque export — une entrée
 * dépubliée en disparaît réellement.
 *
 * Le schéma refuse toute entrée mal formée : une donnée malformée fait échouer
 * la construction du site au lieu de publier une page fausse.
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const journal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: '../data/derive/journal' }),
  schema: z.object({
    titre: z.string().min(1),
    date: z.coerce.date(),
    lieu: z.string(),
    pays: z.string(),
    resume: z.string().min(1),
    pratiques: z.array(z.string()),
  }).strict(),
});

export const collections = { journal };
