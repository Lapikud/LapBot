import { Hono } from 'hono';
import { back, field, flashOf, type Env, type WebDeps } from './context';
import { Layout } from './layout';

export function permissionPages({ services }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const { actor, guild } = c.var;
      const grants = await services.permissions.list(actor);

      return c.html(
        <Layout title="Permissions" path="/permissions" flash={flashOf(c)}>
          <p>Discord administrators hold every permission.</p>
          <form method="post" action="/permissions">
            <div class="grid">
              <label>
                Role
                <select name="roleId">
                  {guild.roles
                    .filter((role) => !role.managed)
                    .map((role) => (
                      <option value={role.id}>@{role.name}</option>
                    ))}
                </select>
              </label>
              <label>
                Permission
                <select name="permission">
                  {services.permissions.catalogue().map((p) => (
                    <option value={p.id}>
                      {p.id} — {p.description}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button name="action" value="grant">
              Grant
            </button>
          </form>
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Permission</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr>
                  <td>@{guild.roleName(grant.roleId)}</td>
                  <td>{grant.permission}</td>
                  <td>
                    <form method="post" action="/permissions">
                      <input type="hidden" name="roleId" value={grant.roleId} />
                      <input
                        type="hidden"
                        name="permission"
                        value={grant.permission}
                      />
                      <button name="action" value="revoke">
                        Revoke
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Layout>,
      );
    })
    .post('/', async (c) => {
      const form = await c.req.formData();
      const action = form.get('action') === 'revoke' ? 'revoke' : 'grant';
      const permission = field(form, 'permission') ?? '';
      const changed = await services.permissions[action](
        c.var.actor,
        field(form, 'roleId') ?? '',
        permission,
      );
      const verb = action === 'grant' ? 'Granted' : 'Revoked';

      return back(c, '/permissions', {
        notice: changed ? `${verb} ${permission}.` : 'Nothing changed.',
      });
    });
}
