export class DbError extends Error {
  status: number;
  details: any;

  constructor(message: string, status = 400, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
