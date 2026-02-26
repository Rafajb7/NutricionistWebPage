export type UserSheetRow = {
  Nombre: string;
  Usuario: string;
  "contraseñas": string;
};

export type RevisionRow = {
  nombre: string;
  fecha: string;
  usuario: string;
  pregunta: string;
  respuesta: string;
};

export type RevisionEntry = RevisionRow & {
  imageUrl: string | null;
};
