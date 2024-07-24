node ('appserver'){  
    def app
    stage('Cloning Git') {
        /* Let's make sure we have the repository cloned to our workspace */
       checkout scm
    }  
    
    stage('Build-and-Tag') {
    /* This builds the actual image; synonymous to
         * docker build on the command line */
        app = docker.build("akshaymisra87/snake")
    }
    stage('Post-to-dockerhub') {
    
     docker.withRegistry('https://registry.hub.docker.com', 'amdocker') {
            app.push("latest")
        			}
         }
  
    
    stage('Pull-image-server') {
    
         sh "docker-compose down"
         sh "docker-compose up -d"	
      }
 
}
