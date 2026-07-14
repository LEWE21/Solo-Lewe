# Le Système — app + serveur

App RPG perso de Mathilde (style Solo Leveling) + un petit serveur Vercel qui appelle Claude.

## Contenu
- `index.html` — l'application (fonctionne seule, données dans le navigateur)
- `api/gm.js` — la fonction serverless (maître du jeu / mentor stoïcien, génération de quêtes, traduction FR→EN)
- `package.json` — dépendance `@anthropic-ai/sdk`

## Déploiement (Vercel)
1. Pousser ce dossier sur un dépôt GitHub (privé).
2. Sur vercel.com → **Add New → Project** → importer le dépôt.
3. Dans **Settings → Environment Variables**, ajouter :
   - `ANTHROPIC_API_KEY` = ta clé API Anthropic (secrète)
   - (optionnel) `SYSTEME_MODEL` = `claude-sonnet-5` pour réduire les coûts
4. **Deploy**. L'app est à l'URL Vercel ; l'API est à `/api/gm`.

## Tester l'API (une fois déployée)
```bash
curl -X POST https://TON-APP.vercel.app/api/gm \
  -H "Content-Type: application/json" \
  -d '{"action":"translate","text":"Ranger le bureau"}'
```
Réponse attendue : `{"en":"Tidy the desk"}`

## Modèle
Par défaut `claude-opus-4-8`. Mettre `SYSTEME_MODEL=claude-sonnet-5` (ou `claude-haiku-4-5`)
dans Vercel pour un coût plus bas.
