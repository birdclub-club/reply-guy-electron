const Store = require('electron-store');

const store = new Store({
  name: 'reply-guy-data',
  defaults: {
    session: null,
    trainingData: null,
    interactionPatterns: {},
    config: {
      timing: {
        viewDuration: 30,
        actionDelay: 5,
        notificationInterval: 60
      },
      account: {
        followThreshold: 100,
        unfollowThreshold: 1000,
        maxFollowsPerDay: 50
      },
      safety: {
        maxDailyInteractions: 100,
        pauseAfterInteractions: 30,
        pauseDuration: 15
      }
    }
  }
});

module.exports = store; 