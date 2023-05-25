# Flowpilot API

Flowpilot's API consists of two parts, One part is the Registration and Login. The other part of it is the API for uploader.

## Registration and Login

Under ``selfdrive/ui/java/ai.flow.app/RegistrationScreen.java``, this file aside from printing the whole UI will send a request including email and password fields using Raw Json directly to the api at ``auth/register`` and the API will process a email verification which will return status code 201, email already exists 202 and if it gets any other response from the API it will throw the error in a UI box so the user can troubleshoot. That part is fairly easy to implement on our API since we are already doing all of that.

Next is Login ``selfdrive/ui/java/ai.flow.app/LoginScreen.java``. This will send a request simular to the register but it will get a response a little different. Request holds email and password and if the API gives a 200 code it will try to save some values from the response which are ``user_id`` and ``auth_token``.
User ID is pretty self explanitory, the Auth Token is a JWT token that it saves. Both of these values are saved in openpilots Params ``UserID``, ``UserToken``, along with ``UserEmail`` which was just grabbed from the input.


## Uploader Deamon

The Uploader Deamon is what sends all the logs and video files directly to the API. In this case most of the code here has been rewriten or at least modified to use AWS S3 instead of just sending directly to the API instead. In the file ``common/api/__init__.py`` they have rewriten this file to send a request to the API to aquire AWS S3 credentials. It sends a request to ``auth/sts`` with a Authorization header Bearing the JWT token. The API in response gets ``access_key``, ``secret_access_key``, and ``session_token``. All of these responses from ``auth/sts`` are the AWS S3 authorization values that are fed into boto3 to upload drives and logs to S3. In our API we are going to be using B2 which is fully compatable with S3