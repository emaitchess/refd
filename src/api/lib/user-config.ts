import {
  type ApplicationConfig,
  applicationConfigFor,
} from '../../shared/config';
import { isOperatorEmail } from '../auth/operator';

export const configForUser = (
  email: string,
  adminEmails: unknown,
): ApplicationConfig =>
  applicationConfigFor(isOperatorEmail(email, adminEmails));
