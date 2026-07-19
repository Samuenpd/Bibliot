export {};

declare global {
  interface Window {
    api: {
      books: {
        getAll: () => Promise<any[]>;
        add: (data: any) => Promise<number>;
        update: (id: number, data: any) => Promise<void>;
        delete: (id: number) => Promise<void>;
        toggleRead: (id: number) => Promise<void>;
        toggleFavorite: (id: number) => Promise<void>;
      };
      tags: {
        getAll: () => Promise<any[]>;
        add: (data: { name: string; color: string }) => Promise<number>;
        update: (id: number, data: { name: string; color: string }) => Promise<void>;
        delete: (id: number) => Promise<void>;
      };
    };
  }
}
