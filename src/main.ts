const appRoot = document.querySelector<HTMLElement>('#app');

if (appRoot === null) {
  throw new Error('Brightvale application root #app is missing.');
}

console.info('[brightvale] application shell ready');
