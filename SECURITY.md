# Système de Protection Anti-DDoS

## Vue d'ensemble
Le serveur web inclut un système complet de protection contre les attaques DDoS et les abus d'API.

## Fonctionnalités de Protection

### 1. Limitation de Taux (Rate Limiting)
- **Maximum 30 requêtes par minute** par IP
- **Maximum 200 requêtes par heure** par IP
- **Détection de patterns suspects** (plus de 20 requêtes en 10 secondes)

### 2. Système de Blocage
- **Blocage temporaire** après violation des limites
- **Blocage de 15 minutes** si la limite horaire est dépassée
- **Blocage de 5 minutes** pour activité suspecte
- **Système de warnings** progressifs (3 violations avant blocage)

### 3. Détection d'Activité Suspecte
- Analyse des patterns de requêtes
- Détection des burst attacks
- Suivi des adresses IP abusives
- Journalisation des événements de sécurité

## Configuration

Les paramètres de protection sont configurés dans `web-server.js`:

```javascript
const DDOS_PROTECTION = {
    maxRequestsPerMinute: 30,    // Maximum de requêtes par minute
    maxRequestsPerHour: 200,      // Maximum de requêtes par heure
    banThreshold: 50,             // Seuil de blocage
    banDuration: 15 * 60 * 1000,  // Durée du blocage (15 minutes)
    suspiciousThreshold: 20,     // Requêtes suspectes en 10 secondes
    blockDuration: 5 * 60 * 1000  // Durée du blocage suspect (5 minutes)
};
```

## Réponses de Sécurité

### 429 Too Many Requests
Lorsqu'une IP dépasse les limites, le serveur répond avec:
```json
{
  "error": "Too many requests",
  "reason": "Too many requests per minute",
  "retryAfter": 60
}
```

### Journalisation
Tous les événements de sécurité sont journalisés:
```
[SECURITY] 2024-01-01T12:00:00.000Z - IP: 192.168.1.1 - Event: BLOCKED - Details: Too many requests per minute
```

## Protection contre les Simulations de Requêtes

Le système protège contre:
- **Requêtes rapides en série** (burst attacks)
- **Automation abusive** (scripts de spam)
- **Scan d'API** massif
- **Tentatives de force brute**

## Fonctionnement Interne

### Tracking par IP
Chaque adresse IP est suivie individuellement avec:
- Historique des requêtes (timestamp)
- Compteur total de requêtes
- Statut de blocage
- Historique des violations

### Nettoyage Automatique
- Les requêtes anciennes (plus de 1 heure) sont automatiquement nettoyées
- Les blocages expirent automatiquement après leur durée
- Les compteurs sont réinitialisés périodiquement

## Adaptation des Limites

Pour adapter les limites à vos besoins:

1. **Augmenter la capacité**: Modifiez `maxRequestsPerMinute` et `maxRequestsPerHour`
2. **Durcir la protection**: Baissez les seuils et augmentez les durées de blocage
3. **Adoucir la protection**: Augmentez les seuils pour plus de tolérance

## Surveillance

Pour surveiller l'activité:
- Consultez les logs de sécurité dans la console
- Surveillez les réponses 429
- Analysez les patterns d'attaque potentiels

## Recommandations

1. **En production**: Utilisez un système de session persistant (Redis, database)
2. **Surveillance**: Mettez en place des alertes pour les activités suspectes
3. **Maintenance**: Révisez régulièrement les logs de sécurité
4. **Tests**: Testez les limites avec des outils de charge contrôlés

## Notes Importantes

- Le système utilise l'adresse IP réelle du client (supporte X-Forwarded-For)
- Les blocages sont temporaires et automatiques
- Aucune donnée personnelle n'est stockée (uniquement les IPs et timestamps)
- Le système est conçu pour être non-intrusif pour les utilisateurs légitimes