# py-send

Plateforme de messagerie rétro/pixelisée avec salons et messages privés, prête pour un déploiement simple sur Netlify.

## Stack (simple + Netlify-friendly)
- Frontend statique (HTML/CSS/JS)
- Backend Supabase (auth + base + realtime)

## Mise en route rapide
1. Créer un projet Supabase.
2. Dans Supabase SQL Editor, exécuter le contenu de `schema.sql`.
3. (Optionnel) Dans Auth > Providers, désactiver la confirmation email pour faciliter les tests.
4. Renseigner `config.js` avec `supabaseUrl` et `supabaseAnonKey`.
5. Ouvrir `index.html` localement, ou déployer sur Netlify.

## Déploiement Netlify
1. Pousser ce dossier sur GitHub.
2. Netlify > New site from Git > sélectionner le repo.
3. Build command: laisser vide. Publish directory: `/` (racine).
4. Déployer.

## Fonctionnalités
- Inscription / connexion
- Salons publics (création + liste)
- Messages temps réel
- Amis + discussions privées (DM)

## Notes
- Les discussions privées créent un salon DM entre deux utilisateurs.
- Tout est côté client, donc les clés Supabase sont publiques (utiliser les RLS).
