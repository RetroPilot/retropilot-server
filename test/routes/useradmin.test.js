import request from 'supertest';
import dummyGenerator from '../dummyGenerator';

export default (app) => {
  describe('/useradmin', () => {
    it('Page load', (done) => {
      request(app)
        .get('/useradmin')
        .expect('Content-Type', /html/)
        .expect(200)
        .end(done);
    });

    it('Redirect on existing session', (done) => {
      request(app)
        .get('/useradmin')
        // pull sessions from a store
        .set('Cookie', ['session=s%3Aj%3A%7B%22account%22%3A%22adam%40adamblack.us%22%2C%22expires%22%3A1653171350726%7D.cRX19pNfx6mCGZ9ZYHcUIyy5CAQVMDgKrp%2F%2Bf7NFVYA;'])
        .expect('Location', '/useradmin/overview')
        .expect(302)
        .end(done);
    });
  });

  describe('/useradmin/register/token', () => {
    it('No duplicate emails', (done) => {
      request(app)
        .post('/useradmin/register/token')
        // TODO add dedicated DB/user account for tests to run on
        .send(`email=${dummyGenerator.alreadyRegisteredEmail}`)
        .set('Accept', 'application/x-www-form-urlencoded')
        .expect('Location', `/useradmin/register?status=${encodeURIComponent('Email is already registered')}`)
        .end(done);
    });

    it('Accepts new accounts', (done) => {
      request(app)
        .post('/useradmin/register/token')
        // TODO add dedicated DB/user account for tests to run on
        .send(`email=${dummyGenerator.newUserEmail}`)
        .set('Accept', 'application/x-www-form-urlencoded')
        .expect(200)
        .end(done);
    });
  });
};
