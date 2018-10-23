import Logger from 'util/Logger';
import StorageProvider from 'providers/StorageProvider';
import * as axios from 'axios';
import * as _ from 'lodash';


var logger = new Logger('[GoogleDrive.js]');

export default class GoogleDrive extends StorageProvider {
  constructor() {
    super();
    
    this.accessToken = null;
    this.refreshToken = null;
  }

  getType() {
    return 'googledrive';
  }
  getCredentials() {
    return this.accessToken ? { accessToken: this.accessToken, refreshToken: this.refreshToken } : null;
  }
  isAuthed() {
    return this.accessToken ? true : false;  
  }
  authorize(credentials) {
    this.accessToken = credentials.accessToken;
    this.refreshToken = credentials.refreshToken;

    return Promise.resolve();
  }
  deauthorize() {
    return this.checkRefreshToken()
      .then(() => {
        return axios({
          method: 'get',
          url: 'https://accounts.google.com/o/oauth2/revoke',
          params: {
            token: this.accessToken
          }
        });
      })
      .then(() => {
        this.accessToken = null;
        this.refreshToken = null;
      });
  }
  checkRefreshToken() {
    logger.log('Verifying access token...');

    return axios({
      method: 'get',
      url: 'https://www.googleapis.com/oauth2/v1/tokeninfo',
      params: {
        access_token: this.accessToken
      }
    })
      .catch(() => {
        logger.log('Access token expired. Attempting to fetch new token...');
        
        // Token invalid, get new refresh token
        return axios({
          method: 'post',
          url: PRODUCTION ? 'https://syncmarx.gregmcleod.com/auth/googledrive/refreshtoken' : 'http://localhost:1800/auth/googledrive/refreshtoken',
          params: {
            refresh_token: this.refreshToken
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          }
        })
        .then((response) => {
          this.accessToken = response.data.access_token;

          logger.log('Obtained new token!');

          return response;
        });
      })
      .then((response) => {
        logger.log('Token info:', response.data);
      });
  }
  filesList() {
    return this.checkRefreshToken()
      .then(() => {
        return axios({
          method: 'get',
          url: 'https://www.googleapis.com/drive/v3/files',
          params: {
            spaces: 'appDataFolder'
          },
          headers: { 'Authorization': 'Bearer ' + this.accessToken }
        })
      })
      .then((response) => {
        console.log(response.data.files);
        return _.map(response.data.files, (file) => {
          return {
            id: file.id,
            name: file.name,
            path_lower: '/' + file.name.toLowerCase(), // TODO: Remove need for this and just use 'id' field
            path_display: '/' + file.name
          };
        });
      });
  }
  fileUpload(data) {
    // Encrypt and compress
    var encryptedData = (data.compression) ? this.encryptData(data.contents) : JSON.stringify(data.contents, null, 2);

    var file = new Blob([encryptedData], {"type": "text/plain"});
    var fileName = data.path.replace(/^\//g, '');

    return this.checkRefreshToken()
      .then(() => {
        // Get existing file list first
        return this.filesList();
      })
      .then((files) => {
        // See if a file exists with this file name already
        let existingFile = _.find(files, (f) => '/' + f.name === data.path);

        // Choose appropriate method and URL based on create VS update
        let method = existingFile ? 'PUT' : 'POST';
        let url = 'https://www.googleapis.com/upload/drive/v3/files';

        if (existingFile) {
          url += `/${existingFile.id}`;
        }

        // Intitiate the upload
        return axios({
          method: method,
          url: url,
          params: {
            uploadType: 'resumable',
          },
          data: {
            name: fileName,
            mimeType: 'text/plain',
            parents: ['appDataFolder']          
          },
          headers: {
            'Authorization': 'Bearer ' + this.accessToken,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': file.size,
            'X-Upload-Content-Type': 'text/plain'
          }
        });
      })
      .then((response) => {
        console.info(response);
        
        // Upload the file
        return axios({
          method: 'PUT',
          url: response.headers.location,
          params: {
            uploadType: 'resumable'
          },
          data: file,
          headers: {
            'Authorization': 'Bearer ' + this.accessToken
          }
        })
      })
      .then((response) => {
        console.info(response);
      });
  }
  fileDownload(data) {
    return this.checkRefreshToken()
      .then(() => {
        // Get existing file list first
        return this.filesList();
      })
      .then((files) => {
        // See if a file exists with this file name already
        let existingFile = _.find(files, (f) => '/' + f.name === data.path);
        
        // Intitiate the download
        return axios({
          method: 'GET',
          url: `https://www.googleapis.com/drive/v3/files/${existingFile.id}`,
          params: {
            alt: 'media'
          },
          headers: {
            'Authorization': 'Bearer ' + this.accessToken
          }
        });
      })
      .then((response) => {
        logger.log('File downloaded!', response);

        // Decompress and decrypt
        var contents = null;
        var compressed = false;

        try {
          contents = JSON.parse(response.data);
        } catch(e) {
          contents = this.decryptData(response.data);
          compressed = true;
        }

        return { contents: contents, compressed: compressed };
      });
  }
}