// Version de l'app : injectée à la compilation, ou lue depuis npm en développement (tsx).
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : (process.env.npm_package_version ?? 'dev');
