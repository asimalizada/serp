export class DuplicateClientError extends Error {
  constructor(message = 'Website already exists for this user') {
    super(message);
    this.name = 'DuplicateClientError';
  }
}
